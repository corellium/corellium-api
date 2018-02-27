const EventEmitter = require('events');
const crypto = require('crypto');
const stringify = require('fast-stable-stringify');
const openstack = require('openstack-api');
const c3po = require('./c3po');
const websocket = require('websocket-stream');

class Instance extends EventEmitter {
    constructor(account, project, info, metadata) {
        super();

        this.account = account;
        this.project = project;
        this.updating = false;
        this.updateTimeout = null;
        this.hash = null;
        this.hypervisorStream = null;
        this.lastPanicLength = null;

        this.on('newListener', () => {
            this.manageUpdates(true);
        });

        this.on('removeListener', () => {
            this.manageUpdates(false);
        });

        this.processInstanceUpdate(info, metadata);
    }

    id() {
        return this.info.id;
    }

    name() {
        return this.info.name;
    }

    status() {
        return this.info.status;
    }

    key() {
        return Buffer.from(this.metadata.key, 'hex');
    }

    async panics() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id(), this.key(), {
            'type': 'panic',
            'op': 'get'
        }));
        return results['panics'];
    }

    async clearPanics() {
        let hypervisor = await this.hypervisor();
        return hypervisor.command(await hypervisor.signedCommand(this.id(), this.key(), {
            'type': 'panic',
            'op': 'clear'
        }));
    }

    async hypervisor() {
        await this.waitForInstance(() => {
            if (!this.info || this.info['status'] === 'DELETED')
                throw new openstack.exceptions.APIException(1001, 'instance gone');

            if (!this.metadata['port-c3po'])
                return false;
            
            if (!this.metadata['vpn-info'])
                return false;

            try {
                let parsed = JSON.parse(this.metadata['vpn-info']);
                if (parsed['ip'])
                    return true;
            } catch (err) {
                return false;
            }

            return false;
        });

        let [host, port] = this.metadata['port-c3po'].split(':');

        // XXX: We want the external host, so take it from VPN for now.
        host = JSON.parse(this.metadata['vpn-info'])['ip'];

        if (this.hypervisorStream && this.hypervisorStream.active) {
            if (host === this.hypervisorStream.host && port === this.hypervisorStream.port)
                return this.hypervisorStream;

            this.hypervisorStream.disconnect();
            this.hypervisorStream = null;
        }

        this.hypervisorStream = new c3po.HypervisorStream(host, port);
        return this.hypervisorStream;
    }

    async console() {
        let projectToken = await this.project.token();
        let wsUrl = await openstack.compute.serialConsole(projectToken.token, this.id());
        return websocket(wsUrl, ['binary']);
    }

    processInstanceUpdate(info, metadata) {
        const hasher = crypto.createHash('sha256');
        hasher.update(stringify([info, metadata]));
        let hash = hasher.digest();

        if (!this.hash || !hash.equals(this.hash)) {
            this.hash = hash;
            this.info = info;
            this.metadata = metadata;
            
            this.emit('change');

            let panicLength = parseInt(this.metadata['panic-length']);
            if (panicLength !== this.lastPanicLength) {
                this.lastPanicLength = panicLength;
                if (panicLength)
                    this.emit('panic');
            }
        }
    }

    async update() {
        let projectToken = await this.project.token();
        let id = this.id();

        try {
            let [[instanceInfo, metadata], corelliumMetadata] =
                await Promise.all([
                    openstack.compute.instance(projectToken.token, id),
                    openstack.compute.instanceMetadata(projectToken.token, id)
                ]);
            this.processInstanceUpdate(instanceInfo, Object.assign(metadata, corelliumMetadata));
        } catch (err) {
            this.processInstanceUpdate(Object.assign({}, this.info, {status: 'DELETED'}), this.metadata);
        }
    }

    async start() {
        let projectToken = await this.project.token();
        let id = this.id();

        await openstack.compute.instanceOpenStackMetadataDelete(projectToken.token, id, 'is-restore')
        try {
            await openstack.compute.instanceStart(projectToken.token, id);
        } catch(err) {
            await this.update();
            if (this.info['status'] !== 'SHELVED_OFFLOADED')
                throw err;

            let started = new Date(this.metadata['restore-snapshot-started']);
            if (new Date(started.getTime() + 3 * 60000) > new Date())
                throw err;

            await openstack.compute.instanceUnshelve(projectToken.token, id);
            await openstack.compute.instanceOpenStackMetadataDelete(projectToken.token, id, 'restore-snapshot-started');
        }
    }

    async stop() {
        let projectToken = await this.project.token();
        let id = this.id();

        await openstack.compute.instanceStop(projectToken.token, id);
    }

    async reboot() {
        let projectToken = await this.project.token();
        let id = this.id();

        await openstack.compute.instanceReboot(projectToken.token, id);
    }

    async destroy() {
        let projectToken = await this.project.token();
        let id = this.id();

        let tagPromise = openstack.compute.instanceTag(projectToken.token, id, 'deleting');
        let volumes = await openstack.compute.instanceVolumes(projectToken.token, id);

        await openstack.compute.instanceDelete(projectToken.token, id);
        
        openstack.compute.instanceWaitForDeleted(projectToken.token, id).then(() => {
            return Promise.all(volumes.map(volumeId => {
                return openstack.volume.volumeDelete(projectToken.token, this.project.id(), volumeId);
            }));
        });

        await tagPromise;
        return;
    }

    async doUpdate() {
        await this.update();
        if (this.listenerCount('change') !== 0)
            this.updateTimeout = setTimeout(this.doUpdate.bind(this), 5000);
    }

    manageUpdates(add) {
        if (add && !this.updating) {
            this.updating = true;
            this.doUpdate();
        } else if (!add && this.listenerCount('change') === 0 && this.updating) {
            this.updating = false;
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
                this.updateTimeout = null;
            }
        }
    }

    async waitForInstance(callback) {
        return new Promise(resolve => {
            let change = () => {
                if (callback()) {
                    this.removeListener('change', change);
                    resolve();
                }
            };

            this.on('change', change);
            change();
        });
    }

    async waitForMetadata(property) {
        return this.waitForInstance(() => {
            if (!this.info || this.info['status'] === 'DELETED')
                throw new openstack.exceptions.APIException(1001, 'instance gone');

            if (property instanceof Array) {
                return property.every(property => {
                    return !!this.metadata[property];
                });
            }

            if (this.metadata[property])
                return true;

            return false;
        });
    }

    async finishRestore() {
        return this.waitForInstance(() => {
            if (!this.info || this.info['status'] === 'DELETED')
                throw new openstack.exceptions.APIException(1001, 'instance gone');

            if (!this.metadata['is-restore'])
                return true;

            if (this.info['status'] !== 'ACTIVE' && this.info['status'] !== 'BUILD' && this.info['status'] !== 'PAUSED')
                throw new openstack.exceptions.APIException(1002, 'unexpected state');

            return false;
        });
    }
}

module.exports = Instance;
