const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const c3po = require('./c3po');
const websocket = require('websocket-stream');
const Snapshot = require('./snapshot');
const Agent = require('./agent');
const Buttons = require('./buttons');

class Instance extends EventEmitter {
    constructor(project, info) {
        super();

        this.project = project;
        this.info = info;
        this.id = info.id;
        this.updating = false;

        this.hash = null;
        this.hypervisorStream = null;
        this.agentStream = null;
        this.lastAgentEndpoint = null;
        this.lastPanicLength = null;
        this.volumeId = null;

        this.buttons = new Buttons(this);

        this.on('newListener', (event) => {
            if (event === 'change')
                this.project.updater.add(this);
        });
        this.on('removeListener', (event) => {
            if (event === 'change' && this.listenerCount('change') == 0)
                this.project.updater.remove(this);
        });
    }

    get name() {
        return this.info.name;
    }

    get state() {
        return this.info.state;
    }

    get flavor() {
        return this.info.flavor;
    }

    async rename(name) {
        await this._fetch('', {
            method: 'PATCH',
            json: {name},
        });
    }

    async snapshots() {
        const snapshots = await this._fetch('/snapshots');
        return snapshots.map(snap => new Snapshot(this, snap));
    }

    async takeSnapshot(name) {
        const snapshot = await this._fetch('/snapshots', {
            method: 'POST',
            json: {name},
        });
        return new Snapshot(this, snapshot);
    }

    async consoleLog() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'console',
            'op': 'get'
        }));
        return results['log'];
    }

    async panics() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'panic',
            'op': 'get'
        }));
        return results['panics'];
    }

    async clearPanics() {
        let hypervisor = await this.hypervisor();
        return hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'panic',
            'op': 'clear'
        }));
    }

    async hypervisor() {
        await this._waitFor(() => !!this.info.c3po);

        let endpoint = this.project.api + '/c3po/' + this.info.c3po;

        if (this.hypervisorStream && this.hypervisorStream.active) {
            if (endpoint === this.hypervisorStream.endpoint)
                return this.hypervisorStream;

            this.hypervisorStream.disconnect();
            this.hypervisorStream = null;
        }

        this.hypervisorStream = new c3po.HypervisorStream(endpoint);
        return this.hypervisorStream;
    }

    async agent() {
        if (this.agentStream)
            return this.agentStream.connect();

        this.agentStream = new Agent(this);
        return this.agentStream.connect();
    }

    async agentEndpoint() {
        await this._waitFor(() => !!this.info.agent);
        if (this.lastAgentEndpoint) {
            // We already have an agentEndpoint, we probably should refresh it.
            await this.update();
        }

        this.lastAgentEndpoint = this.project.api + '/agent/' + this.info.agent.info;
        return this.lastAgentEndpoint;
    }

    async newAgent() {
        await this._waitFor(() => !!this.info.agent);
        let endpoint = this.project.api + '/agent/' + this.info.agent.info;
        return (new Agent(this)).connect();
    }

    async console() {
        const {url} = await this._fetch('/console');
        return websocket(url, ['binary']);
    }

    async sendInput(input) {
        await this._fetch('/input', {method: 'POST', json: input.points});
    }

    async start() {
        await this._fetch('/start', {method: 'POST'});
    }

    async stop() {
        await this._fetch('/stop', {method: 'POST'});
    }

    async reboot() {
        await this._fetch('/reboot', {method: 'POST'});
    }

    async destroy() {
        await this._fetch('', {method: 'DELETE'});
    }

    async takeScreenshot(options) {
        const {format = 'png', scale = 1} = options || {};
        const res = await this._fetch(`/screenshot.${format}?scale=${scale}`, {response: 'raw'});
        if (res.buffer)
            return await res.buffer(); // node
        else
            return await res.blob(); // browser
    }

    async update() {
        this.receiveUpdate(await this._fetch(''));
    }

    receiveUpdate(info) {
        // one way of checking object equality
        if (JSON.stringify(info) != JSON.stringify(this.info)) {
            this.info = info;
            this.emit('change');
            if (info.panicked)
                this.emit('panic');
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

    async finishRestore() {
        await this._waitFor(() => this.state !== 'creating');
    }

    async waitForState(state) {
        await this._waitFor(() => this.state === state);
    }

    async _fetch(endpoint = '', options = {}) {
        return await fetchApi(this.project, `/instances/${this.id}${endpoint}`, options);
    }
}

module.exports = Instance;
