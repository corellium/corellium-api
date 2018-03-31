const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const crypto = require('crypto');
const stringify = require('fast-stable-stringify');
const c3po = require('./c3po');
const websocket = require('websocket-stream');
const Snapshot = require('./snapshot');
const util = require('util');
const sleep = util.promisify(setTimeout);

class Instance extends EventEmitter {
    constructor(project, info) {
        super();

        this.project = project;
        this.info = info;
        this.id = info.id;
        this.updating = false;

        this.hash = null;
        this.hypervisorStream = null;
        this.lastPanicLength = null;
        this.volumeId = null;

        this.on('newListener', () => this.manageUpdates());
    }

    get name() {
        return this.info.name;
    }

    get state() {
        return this.info.state;
    }

    async rename(name) {
        await this.fetch('', {
            method: 'PATCH',
            json: {name},
        });
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
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, this.info.key, {
            'type': 'panic',
            'op': 'get'
        }));
        return results['panics'];
    }

    async clearPanics() {
        let hypervisor = await this.hypervisor();
        return hypervisor.command(await hypervisor.signedCommand(this.id, this.info.key, {
            'type': 'panic',
            'op': 'clear'
        }));
    }

    async hypervisor() {
        await this._waitFor(() => this.info.services.vpn && this.info.services.vpn.ip);

        let [host, port] = this.info.services.c3po.split(':');

        // XXX: We want the external host, so take it from VPN for now.
        host = this.info.services.vpn.ip;

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
        const {url} = await this.fetch('/console');
        return websocket(url, ['binary']);
    }

    async start() {
        await this.fetch('/start', {method: 'POST'});
    }

    async stop() {
        await this.fetch('/stop', {method: 'POST'});
    }

    async reboot() {
        await this.fetch('/reboot', {method: 'POST'});
    }

    async destroy() {
        await this.fetch('', {method: 'DELETE'});
    }

    async update() {
        const info = await this.fetch('');
        // one way of checking object equality
        if (JSON.stringify(info) != JSON.stringify(this.info)) {
            this.info = info;
            this.emit('change');
            if (info.panicked)
                this.emit('panic');
        }
    }

    manageUpdates() {
        if (this.updating)
            return;
        process.nextTick(async () => {
            this.updating = true;
            do {
                await this.update();
                await sleep(1000);
            } while (this.listenerCount('change') != 0);
            this.updating = false;
        });
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

    async finishRestore() {
        await this._waitFor(() => this.state !== 'creating');
    }

    async waitForState(state) {
        await this._waitFor(() => this.state === state);
    }

    async fetch(endpoint = '', options = {}) {
        return await fetchApi(this.project, `/instances/${this.id}${endpoint}`, options);
    }
}

module.exports = Instance;
