const WebSocket = require('ws');
const stream = require('stream');

let Sockets = new Set();

/**
 * A connection to the agent running on an instance.
 *
 * Instances of this class
 * are returned from {@link Instance#agent} and {@link Instance#newAgent}. They
 * should not be created using the constructor.
 * @hideconstructor
 */
class Agent {
    constructor(instance) {
        this.instance = instance;
        this.connected = false;
        this.connectPromise = null;
        this.id = 0;
    }

    /**
     * Ensure the agent is connected.
     * @private
     */
    async connect() {
        this.pendingConnect = true;
        if (!this.connected)
            await this.reconnect();
    }

    /**
     * Ensure the agent is disconnected, then connect the agent.
     * @private
     */
    async reconnect() {
        if (this.connected)
            this.disconnect();

        if (this.connectPromise)
            return this.connectPromise;

        this.connectPromise = (async () => {
            while (this.pendingConnect) {
                try {
                    await this._connect();
                    break;
                } catch (e) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            this.connectPromise = null;
        })();
    }

    async _connect() {
        this.pending = new Map();

        const endpoint = await this.instance.agentEndpoint();
        
        // Detect if a disconnection happened before we were able to get the agent endpoint.
        if (!this.pendingConnect)
            throw new Error('connection cancelled');

        let ws = new WebSocket(endpoint);

        Sockets.add(ws); console.log('(open) num agent sockets = ', Sockets.size);
        this.ws = ws;

        ws.on('message', data => {
            try {
                let message;
                let id;
                if (typeof data === 'string') {
                    message = JSON.parse(data);
                    id = message['id'];
                } else if (data.length >= 8) {
                    id = data.readUInt32LE(0);
                    message = data.slice(8);
                }

                let handler = this.pending.get(id);
                if (handler) {
                    // will work regardless of whether handler returns a promise
                    Promise.resolve(handler(null, message)).then(shouldDelete => {
                        if (shouldDelete)
                            this.pending.delete(id);
                    });
                }
            } catch (err) {
                console.error('error in agent message handler', err);
            }
        });

        ws.on('close', (code, reason) => {
            this.pending.forEach(handler => {
                handler(new Error(`disconnected ${reason}`));
            });
            this.pending = new Map();
            this._disconnect();
        });

        await new Promise((resolve, reject) => {
            ws.once('open', () => {
                if (this.ws !== ws) {
                    try {
                        ws.close()
                    } catch (e) {}
                    Sockets.delete(ws); console.log('(close) num agent sockets = ', Sockets.size);

                    reject(new Error('connection cancelled'));
                    return;
                }

                ws.on('error', err => {
                    this.pending.forEach(handler => {
                        handler(err);
                    });
                    this.pending = new Map();

                    if (this.ws === ws) {
                        this._disconnect();
                    } else {
                        try {
                            ws.close()
                        } catch (e) {}
                        Sockets.delete(ws); console.log('(close) num agent sockets = ', Sockets.size);
                    }

                    console.error('error in agent socket', err);
                });

                resolve();
            });

            ws.once('error', err => {
                if (this.ws === ws) {
                    this._disconnect();
                } else {
                    try {
                        ws.close()
                    } catch (e) {}
                    Sockets.delete(ws); console.log('(close) num agent sockets = ', Sockets.size);
                }

                reject(err);
            });
        });
        this.connected = true;
    }

    /**
     * Disconnect an agent connection. This is usually only required if a new
     * agent connection has been created and is no longer needed, for example
     * if the `crashListener` in the example at {@link Agent#crashes} is not
     * needed anymore.
     */
    disconnect() {
        this.pendingConnect = false;
        this._disconnect();
    }

    _disconnect() {
        this.connected = false;
        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {}
            Sockets.delete(this.ws); console.log('(close) num agent sockets = ', Sockets.size);
            this.ws = null;
        }
    }

    /**
     * Send a command to the agent.
     *
     * When the command is responded to with an error, the error is thrown.
     * When the command is responded to with success, the handler callback is
     * called with the response as an argument.
     *
     * If the callback returns a value, that value will be returned from
     * `command`; otherwise nothing will happen until the next response to the
     * command. If the callback throws an exception, that exception will be
     * thrown from `command`.
     *
     * If no callback is specified, it is equivalent to specifying the callback
     * `(response) => response`.
     *
     * @param {string} type - passed in the `type` field of the agent command
     * @param {string} op - passed in the `op` field of the agent command
     * @param {Object} params - any other parameters to include in the command
     * @param {function} [handler=(response) => response] - the handler callback
     * @param {function} [uploadHandler] - a kludge for file uploads to work
     * @private
     */
    async command(type, op, params, handler, uploadHandler) {
        if (handler === undefined)
            handler = (response) => response;

        const id = this.id;
        this.id++;
        const message = Object.assign({type, op, id}, params);

        await this.connect();
        this.ws.send(JSON.stringify(message)); // TODO handle errors from ws.send
        if (uploadHandler)
            uploadHandler(id);

        return await new Promise((resolve, reject) => {
            this.pending.set(id, async (err, response) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (response.error) {
                    reject(Object.assign(new Error(), response.error));
                    return;
                }

                try {
                    const result = await handler(response);
                    if (result !== undefined) {
                        resolve(result);
                        return true; // stop calling us
                    }
                    return false;
                } catch (e) {
                    reject(e);
                    return true;
                }
            });
        });
    }

    // TODO handle errors from ws.send
    sendBinaryData(id, data) {
        let idBuffer = Buffer.alloc(8, 0);
        idBuffer.writeUInt32LE(id, 0);
        if (data)
            this.ws.send(Buffer.concat([idBuffer, data]));
        else
            this.ws.send(idBuffer);
    }

    /**
     * Wait for the instance to be ready to use. On iOS, this will wait until Springboard has launched.
     */
    async ready() {
        await this.command('app', 'ready');
    }

    /**
     * Uninstalls the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to uninstall.
     * @param {Agent~progressCallback} progress - The progress callback.
     */
    async uninstall(bundleID, progress) {
        await this.command('app', 'uninstall', {bundleID}, (message) => {
            if (message.success)
                return message;
            if (progress && message.progress)
                progress(message.progress, message.status);
        });
    }

    /**
     * Launches the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to launch.
     */
    async run(bundleID) {
        await this.command('app', 'run', {bundleID});
    }

    /**
     * Kill the app with the given bundle ID, if it is running.
     * @param {string} bundleID - The bundle ID of the app to kill.
     */
    async kill(bundleID) {
        await this.command('app', 'kill', {bundleID});
    }

    /**
     * Returns an array of installed apps.
     */
    async appList() {
        const {apps} = await this.command('app', 'list');
        return apps;
    }

    /**
     * A callback for progress messages. Can be passed to {@link Agent#install}, {@link Agent#installFile}, {@link Agent#uninstall}.
     * @callback Agent~progressCallback
     * @param {number} progress - The progress, as a number between 0 and 1.
     * @param {string} status - The current status.
     */

    /**
     * Installs an app. The app's IPA must be available on the VM's filesystem. A progress callback may be provided.
     *
     * @see {@link Agent#upload} to upload a file to the VM's filesystem
     * @see {@link Agent#installFile} to handle both the upload and install
     *
     * @param {string} path - The path of the IPA on the VM's filesystem.
     * @param {Agent~progressCallback} [progress] - An optional callback that
     * will be called with information on the progress of the installation.
     * @async
     *
     * @example
     * await agent.install('/var/tmp/temp.ipa', (progress, status) => {
     *     console.log(progress, status);
     * });
     */
    async install(path, progress) {
        await this.command('app', 'install', {path}, (message) => {
            if (message.success)
                return message;
            if (progress && message.progress)
                progress(message.progress, message.status);
        });
    }

    async profileList() {
        const {profiles} = await this.command('profile', 'list');
        return profiles;
    }

    async installProfile(profile) {
        await this.command('profile', 'install', {profile: Buffer.from(profile).toString('base64')});
    }

    async removeProfile(profileID) {
        await this.command('profile', 'remove', {profileID});
    }

    async getProfile(profileID) {
        const {profile} = await this.command('profile', 'get', {profileID});
        if (!profile)
            return null;
        return new Buffer(profile, 'base64');
    }

    /**
     * Returns a temporary random filename on the VMs filesystem that by the
     * time of invocation of this method is guaranteed to be unique.
     * @see example at {@link Agent#upload}
     */
    async tempFile() {
        const {path} = await this.command('file', 'temp');
        return path;
    }

    /**
     * Reads from the specified stream and uploads the data to a file on the VM.
     * @param {string} path - The file path to upload the data to.
     * @param {ReadableStream} stream - The stream to read the file data from.
     * @example
     * const tmpName = await agent.tempFile();
     * await agent.upload(tmpName, fs.createReadStream('test.ipa'));
     */
    async upload(path, stream) {
        await this.command('file', 'upload', {path}, undefined, (id) => {
            stream.on('data', data => {
                this.sendBinaryData(id, data);
            });
            stream.on('end', () => {
                this.sendBinaryData(id);
            });
        });
    }

    /**
     * Downloads the file at the given path from the VM's filesystem. Returns a node ReadableStream.
     * @param {string} path - The path of the file to download.
     * @example
     * const dl = agent.download('/var/tmp/test.log');
     * dl.pipe(fs.createWriteStream('test.log'));
     */
    download(path) {
        let command;
        const agent = this;
        return new stream.Readable({
            read() {
                if (command)
                    return;
                command = agent.command('file', 'download', {path}, (message) => {
                    if (!Buffer.isBuffer(message))
                        return;
                    if (message.length === 0)
                        return true;
                    this.push(message);
                });
                command
                    .then(() => this.push(null))
                    .catch(err => this.emit('error', err));
            }
        });
    }

    /**
     * Reads a packaged app from the provided stream, uploads the app to the VM
     * using {@link Agent#upload}, and installs it using {@link Agent#install}.
     * @param {ReadableStream} stream - The app to install.
     * @param {Agent~progressCallback} progress - The callback for install progress information.
     * @example
     * await agent.installFile(fs.createReadStream('test.ipa'), (progress, status) => {
     *     console.log(progress, status);
     * });
     */
    async installFile(stream, progress) {
        let path = await this.tempFile();
        await this.upload(path, stream);
        await this.install(path, progress);
    }

    /**
     * Delete the file at the specified path on the VM's filesystem.
     * @param {string} path - The path of the file on the VM's filesystem to delete.
     */
    async deleteFile(path) {
        const response = await this.command('file', 'delete', {path});
        return response.path;
    }

    /**
     * Subscribe to crash events for the app with the given bundle ID. The callback will be called as soon as the agent finds a new crash log.
     *
     * The callback takes two parameters:
     *  - `err`, which is undefined unless an error occurred setting up or waiting for crash logs
     *  - `crash`, which contains the full crash report data
     *
     * **Note:** Since this method blocks the communication channel of the
     * agent to wait for crash reports, a new {@link Agent} connection should
     * be created with {@link Instance#newAgent}.
     *
     * @see Agent#disconnect
     *
     * @example
     * const crashListener = await instance.newAgent();
     * crashListener.crashes("com.corellium.demoapp", (err, crashReport) => {
     *     if (err) {
     *         console.error(err);
     *         return;
     *     }
     *     console.log(crashReport);
     * });
     */
    async crashes(bundleID, callback) {
        await this.command('crash', 'subscribe', {bundleID}, async (message) => {
            const path = message.file;
            const crashReport = await new Promise(resolve => {
                const stream = this.download(path);
                const buffers = [];
                stream.on('data', data => {
                    buffers.push(data);
                });
                stream.on('end', () => {
                    resolve(Buffer.concat(buffers));
                });
            });

            await this.deleteFile(path);
            callback(null, crashReport.toString('utf8'));
        });
    }

    /** Locks the device software-wise. */
    async lockDevice() {
        await this.command('system', 'lock');
    }

    /** Unlocks the device software-wise. */
    async unlockDevice() {
        await this.command('system', 'unlock');
    }
}

module.exports = Agent;
