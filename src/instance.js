const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const c3po = require('./c3po');
const websocket = require('websocket-stream');
const Snapshot = require('./snapshot');
const Agent = require('./agent');

/**
 * Instances of this class are returned from {@link Project#instances}, {@link
 * Project#getInstance}, and {@link Project#createInstance}. They should not be
 * created using the constructor.
 * @hideconstructor
 */
class Instance extends EventEmitter {
    constructor(project, info) {
        super();

        this.project = project;
        this.info = info;
        this.id = info.id;
        this.updating = false;

        this.hash = null;
        this.hypervisorStream = null;
        this._agent = null;
        this.lastAgentEndpoint = null;
        this.lastPanicLength = null;
        this.volumeId = null;

        this.on('newListener', (event) => {
            if (event === 'change')
                this.project.updater.add(this);
        });
        this.on('removeListener', (event) => {
            if (event === 'change' && this.listenerCount('change') == 0)
                this.project.updater.remove(this);
        });
    }

    /**
     * The instance name.
     */
    get name() {
        return this.info.name;
    }

    /**
     * The instance state. Possible values include:
     *
     * State|Description
     * -|-
     * `on`|The instance is powered on.
     * `off`|The instance is powered off.
     * `creating`|The instance is in the process of creating.
     * `deleting`|The instance is in the process of deleting.
     *
     * A full list of possible values is available in the API documentation.
     */
    get state() {
        return this.info.state;
    }

    /**
     * The instance flavor, such as `iphone6`.
     */
    get flavor() {
        return this.info.flavor;
    }

    /**
     * Rename an instance.
     * @param {string} name - The new name of the instance.
     * @example <caption>Renaming the first instance named `foo` to `bar`</caption>
     * const instances = await project.instances();
     * const instance = instances.find(instance => instance.name == 'foo');
     * await instance.rename('bar');
     */
    async rename(name) {
        await this._fetch('', {
            method: 'PATCH',
            json: {name},
        });
    }

    /**
     * Return an array of this instance's {@link Snapshot}s.
     * @returns {Snapshot[]} This instance's snapshots
     */
    async snapshots() {
        const snapshots = await this._fetch('/snapshots');
        return snapshots.map(snap => new Snapshot(this, snap));
    }

    /**
     * Take a new snapshot of this instance.
     * @param {string} name - The name for the new snapshot.
     * @returns {Snapshot} The new snapshot
     */
    async takeSnapshot(name) {
        const snapshot = await this._fetch('/snapshots', {
            method: 'POST',
            json: {name},
        });
        return new Snapshot(this, snapshot);
    }

    /**
     * Returns a dump of this instance's serial port log.
     */
    async consoleLog() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'console',
            'op': 'get'
        }));
        return results['log'];
    }

    /** Return an array of recorded kernel panics. */
    async panics() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'panic',
            'op': 'get'
        }));
        return results['panics'];
    }

    /** Clear the recorded kernel panics of this instance. */
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

    /**
     * Return an {@link Agent} connected to this instance. Calling this
     * method multiple times will reuse the same agent connection.
     * @returns {Agent}
     */
    async agent() {
        if (!this._agent)
            this._agent = await this.newAgent();
        return this._agent;
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

    /**
     * Create a new {@link Agent} connection to this instance. This is
     * useful for agent tasks that don't finish and thus consume the
     * connection, such as {@link Agent#crashes}.
     * @returns {Agent}
     */
    async newAgent() {
        const agent = new Agent(this);
        await agent.connect();
        return agent;
    }

    /**
     * Returns a bidirectional node stream for this instance's serial console.
     * @example
     * const consoleStream = await instance.console();
     * console.pipe(process.stdout);
     */
    async console() {
        const {url} = await this._fetch('/console');
        return websocket(url, ['binary']);
    }

    /**
     * Send an input to this instance.
     * @param {Input} input - The input to send.
     * @see Input
     * @example
     * await instance.sendInput(I.pressRelease('home'));
     */
    async sendInput(input) {
        await this._fetch('/input', {method: 'POST', json: input.points});
    }

    /** Start this instance. */
    async start() {
        await this._fetch('/start', {method: 'POST'});
    }

    /** Stop this instance. */
    async stop() {
        await this._fetch('/stop', {method: 'POST'});
    }

    /** Reboot this instance. */
    async reboot() {
        await this._fetch('/reboot', {method: 'POST'});
    }

    /** Destroy this instance. */
    async destroy() {
        await this._fetch('', {method: 'DELETE'});
    }

    /**
     * Takes a screenshot of this instance's screen. Returns a Buffer containing image data.
     * @param {Object} options
     * @param {string} [options.format=png] - Either `png` or `jpg`.
     * @param {int} [options.scale=1] - The image scale. Specifying 2 would result
     * in an image with half the instance's native resolution. This is useful
     * because smaller images are quicker to capture and transmit over the
     * network.
     * @example
     * const screenshot = await instance.takeScreenshot();
     * fs.writeFileSync('screenshot.png', screenshot);
     */
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
            /**
             * Fired when a property of an instance changes, such as its name or its state.
             * @event Instance#change
             * @example
             * instance.on('change', () => {
             *     console.log(instance.id, instance.name, instance.state);
             * });
             */
            this.emit('change');
            if (info.panicked)
                /**
                 * Fired when an instance panics. The panic information can be retrieved with {@link Instance#panics}.
                 * @event Instance#panic
                 * @example
                 * instance.on('panic', async () => {
                 *     try {
                 *         console.log('Panic detected!');
                 *         // get the panic log(s)
                 *         console.log(await instance.panics());
                 *         // Download the console log.
                 *         console.log(await instance.consoleLog());
                 *         // Clear the panic log.
                 *         await instance.clearPanics();
                 *         // Reboot the instance.
                 *         await instance.reboot();
                 *     } catch (e) {
                 *         // handle the error somehow to avoid an unhandled promise rejection
                 *     }
                 * });
                 */
                this.emit('panic');
        }
    }

    _waitFor(callback) {
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

    /** Wait for the instance to finish restoring and start its first boot. */
    async finishRestore() {
        await this._waitFor(() => this.state !== 'creating');
    }

    /** Wait for the instance to enter the given state. */
    async waitForState(state) {
        await this._waitFor(() => this.state === state);
    }

    async _fetch(endpoint = '', options = {}) {
        return await fetchApi(this.project, `/instances/${this.id}${endpoint}`, options);
    }
}

module.exports = Instance;
