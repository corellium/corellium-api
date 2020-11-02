const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const websocket = require('websocket-stream');
const ws = require('ws');
const Snapshot = require('./snapshot');
const Agent = require('./agent');
const pTimeout = require('p-timeout')
const NetworkMonitor = require('./netmon');

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
        this.infoDate = new Date();
        this.id = info.id;
        this.updating = false;

        this.hash = null;
        this.hypervisorStream = null;
        this._agent = null;
        this._netmon = null;
        this.lastPanicLength = null;
        this.volumeId = null;
        this.fridaScriptPath = '/data/corellium/frida/scripts/'

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
     * `paused`|The instance is paused.
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
     * The instance type, such as `ios`.
     */
    get type() {
        return this.info.type;
    }

    /**
     * The pending task that is being requested by the user and is being executed by the backend.
     * This field is null when no tasks are pending. The returned object has two fields: name and options.
     *
     * Current options for name are start, stop, pause, unpause, snapshot, revert.
     * For start and revert, options.bootOptions contains the boot options the instance is to be started with.
     *
     */
    get userTask() {
        return this.info.userTask;
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
     * The instance boot options.
     */
    get bootOptions() {
        return this.info.bootOptions;
    }

    /**
     * Change boot options for an instance.
     * @param {Object} bootOptions - The new boot options for the instance.
     * @example <caption>Changing the boot arguments for the instance.</caption>
     * const instances = await project.instances();
     * const instance = instances.find(instance => instance.name == 'foo');
     * await instance.modifyBootOptions(Object.assign({}, instance.bootOptions, {bootArgs: 'new-boot-args'}));
     */
    async modifyBootOptions(bootOptions) {
        await this._fetch('', {
            method: 'PATCH',
            json: {bootOptions},
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
        const response = await this._fetch('/consoleLog', {response: 'raw'});
        return await response.text();
    }

    /** Return an array of recorded kernel panics. */
    async panics() {
        return await this._fetch('/panics');
    }

    /** Clear the recorded kernel panics of this instance. */
    async clearPanics() {
        await this._fetch('/panics', {method: 'DELETE'});
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
        // Extra while loop to avoid races where info.agent gets unset again before we wake back up.
        while (!this.info.agent)
            await this._waitFor(() => !!this.info.agent);

        // We want to avoid a situation where we were not listening for updates, and the info we have is stale (from last boot),
        // and the instance has started again but this time with no agent info yet or new agent info. Therefore, we can use
        // cached if only if it's recent.
        if (((new Date()).getTime() - this.infoDate.getTime()) > (2 * this.project.updater.updateInterval))
            await this.update();

        return this.project.api + '/agent/' + this.info.agent.info;
    }

    async waitForAgentReady() {
        while (true) {
            try {
                await this.agentEndpoint()

                const agentObtained = await pTimeout((async () => {
                    const agent = await this.newAgent()
                    try {
                        await agent.ready()
                        return true
                    } finally {
                        agent.disconnect()
                    }
                })(), 20000, () => {
                    return false
                })

                if (agentObtained)
                    break
            } catch (e) {
                console.log(e)
            }
        }
    }

    /**
     * Create a new {@link Agent} connection to this instance. This is
     * useful for agent tasks that don't finish and thus consume the
     * connection, such as {@link Agent#crashes}.
     * @returns {Agent}
     */
    async newAgent() {
        return new Agent(this);
    }

    /**
     * Return an {@link NetworkMonitor} connected to this instance. Calling this
     * method multiple times will reuse the same agent connection.
     * @returns {NetworkMonitor}
     */
    async networkMonitor() {
        if (!this._netmon)
            this._netmon = await this.newNetworkMonitor();
        return this._netmon;
    }

    async netmonEndpoint() {
        // Extra while loop to avoid races where info.netmon gets unset again before we wake back up.
        while (!this.info.netmon)
            await this._waitFor(() => !!this.info.netmon);

        // We want to avoid a situation where we were not listening for updates, and the info we have is stale (from last boot),
        // and the instance has started again but this time with no agent info yet or new agent info. Therefore, we can use
        // cached if only if it's recent.
        if (((new Date()).getTime() - this.infoDate.getTime()) > (2 * this.project.updater.updateInterval))
            await this.update();

        return this.project.api + '/agent/' + this.info.netmon.info;
    }    

    /**
     * Create a new {@link NetworkMonitor} connection to this instance.
     * @returns {Agent}
     */
    async newNetworkMonitor() {
        return new NetworkMonitor(this);
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

    /** Pause this instance */
    async pause() {
        await this._fetch('/pause', {method: 'POST'});
    }

    /** Unpause this instance */
    async unpause() {
        await this._fetch('/unpause', {method: 'POST'});
    }

    /** Reboot this instance. */
    async reboot() {
        await this._fetch('/reboot', {method: 'POST'});
    }

    /** Destroy this instance. */
    async destroy() {
        await this._fetch('', {method: 'DELETE'});
    }

    /** Get CoreTrace Thread List */
    async getCoreTraceThreadList() {
        return await this._fetch('/strace/thread-list', {method: 'GET'});
    }

    /** Add List of PIDs/Names/TIDs to CoreTrace filter */
    async setCoreTraceFilter(pids, names, tids) {
        let filter = [];
        if (pids.length)  filter = filter.concat(pids.map (pid  => {return {trait: "pid",  value: pid.toString()}}));
        if (names.length) filter = filter.concat(names.map(name => {return {trait: "name", value: name}}));
        if (tids.length)  filter = filter.concat(tids.map (tid  => {return {trait: "tid",  value: tid.toString()}}));
        await this._fetch('', {method: 'PATCH', json: { straceFilter: filter}});
    }

    /** Clear CoreTrace filter */
    async clearCoreTraceFilter() {
        await this._fetch('', {method: 'PATCH', json: {straceFilter: []}});
    }

    /** Start CoreTrace */
    async startCoreTrace() {
        await this._fetch('/strace/enable', {method: 'POST'});
    }

    /** Stop CoreTrace */
    async stopCoreTrace() {
        await this._fetch('/strace/disable', {method: 'POST'});
    }
    
    /** Download CoreTrace Log */
    async downloadCoreTraceLog() {
        const token = await this._fetch('/strace-authorize', {method: 'GET'});
        const response = await fetchApi(this.project, `/preauthed/` + token.token + `/coretrace.log`, {response: 'raw'});
        return await response.buffer();
    }

    /** Clean CoreTrace log */
    async clearCoreTraceLog() {
        await this._fetch('/strace', {method: 'DELETE'});
    }

    /** Get FRIDA console */
    async fridaConsole() {
        const {url} = await this._fetch('/console?type=frida');
        return websocket(url, ['binary']);
    }

    /** Execute FRIDA script by name */
    async executeFridaScript(fileName) {
        const {url} = await this._fetch('/console?type=frida');
        let frida_wc = new ws(url);
        await frida_wc.once('open', () => {
            frida_wc.send('%load ' + this.fridaScriptPath + fileName + '\n');
            frida_wc.close();
        });
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
        this.infoDate = new Date();
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
