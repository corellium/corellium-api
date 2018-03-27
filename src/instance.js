const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const crypto = require('crypto');
const stringify = require('fast-stable-stringify');
const c3po = require('./c3po');
const websocket = require('websocket-stream');
const Snapshot = require('./snapshot');

class Instance extends EventEmitter {
    constructor(project, info) {
        super();

        this.project = project;
        this.info = info;
        this.id = info.id;

        this.hash = null;
        this.hypervisorStream = null;
        this.lastPanicLength = null;
        this.volumeId = null;

        this.on('newListener', () => this.manageUpdates());
    }

    get name() {
        return this.info.name;
    }

    get status() {
        return this.info.status;
    }

    async snapshots() {
        let projectToken = await this.token();
        let [snapshots, volumes] = await Promise.all([
            openstack.volume.volumeSnapshots(projectToken.token, this.project.id()),
            this.volumeId ? Promise.resolve([this.volumeId]) : openstack.compute.instanceVolumes(projectToken.token, this.id())
        ]);

        let mySnapshots = [] 
        volumes.forEach(volumeId => {
            mySnapshots = mySnapshots.concat(snapshots.filter(snapshot => {
                return snapshot.volume_id === volumeId;
            }));

            this.volumeId = volumeId;
        });

        return mySnapshots.map(snapshot => {
            return new Snapshot(this, snapshot);  
        });
    }

    async takeSnapshot(name) {
        let projectToken = await this.token();
        let volumes = await (this.volumeId ? Promise.resolve([this.volumeId]) : openstack.compute.instanceVolumes(projectToken.token, this.id()));
        if (volumes.length === 0)
            throw new openstack.exceptions.APIException(1002, 'instance has no volumes');
        
        this.volumeId = volumes[0];
        return openstack.volume.volumeCreateSnapshot(projectToken.token, this.project.id(), this.volumeId, name);
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
        await this._waitFor(() => this.info.vpn && this.info.vpn.ip);

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
        let projectToken = await this.token();
        let wsUrl = await openstack.compute.serialConsole(projectToken.token, this.id());
        return websocket(wsUrl, ['binary']);
    }

    async start() {
        await fetchApi(this.project, `/instances/${this.id}/start`, {method: 'POST'});
    }

    async stop() {
        await fetchApi(this.project, `/instances/${this.id}/stop`, {method: 'POST'});
    }

    async reboot() {
        await fetchApi(this.project, `/instances/${this.id}/reboot`, {method: 'POST'});
    }

    async destroy() {
        await fetchApi(this.project, `/instances/${this.id}`, {method: 'DELETE'});
    }

    async update() {
        const info = await fetchApi(this.project, `/instances/${this.id}`);
        // one way of checking object equality
        if (JSON.stringify(info) != JSON.stringify(this.info)) {
            this.info = info;
            this.emit('change');
        }
    }

    manageUpdates() {
        if (this.listenerCount('change') != 0) {
            setImmediate(async () => {
                while (this.listenerCount('change') != 0) {
                    this.update();
                    await new Promise((resolve, reject) => setTimeout(resolve, 5000));
                }
            });
        }
    }

    async _waitFor(callback) {
        return new Promise(resolve => {
            const change = () => {
                let done;
                try {
                    done = callback();
                } catch (e) {
                    done = false;
                }
                if (done) {
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
        await this._waitFor(() => this.info.status !== 'creating');
    }

    async waitForStatus(status) {
        await this._waitFor(() => this.info.status === status);
    }
}

module.exports = Instance;
