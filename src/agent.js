const WebSocket = require('ws');
const stream = require('stream');

class DownloadStream extends stream.Readable {
    _read(n) {
    }
}

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
        this.active = true;
        this.pending = new Map();
        this.id = 0;
        this.connectPromise = null;
        this.connectResolve = null;
        this.reconnect();
    }

    async connect() {
        if (this.connectPromise) {
            await this.connectPromise;
            return this;
        }

        return this;
    }

    async reconnect() {
        if (!this.active)
            return;

        if (!this.connectPromise) {
            this.connectPromise = new Promise(resolve => {
                this.connectResolve = resolve;
            });
        }

        let endpoint = await this.instance.agentEndpoint();
        this.ws = new WebSocket(endpoint);
        this.ws.on('message', data => {
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
                    if (handler(null, message))
                        this.pending.delete(id);
                }
            } catch (err) {
                console.error(err);
            }
        });
        
        this.ws.on('open', err => {
            this.connectResolve();
            this.connectPromise = null;
            this.connectResolve = null;
        });

        this.ws.on('error', err => {
            this.pending.forEach(handler => {
                handler(err);
            });
            this.pending = new Map();

            if (this.connectResolve) {
                let oldResolve = this.connectResolve;
                setTimeout(() => {
                    this.connectPromise = null;
                    this.connectResolve = null;
                    this.active = true;
                    this.reconnect();
                    this.connectPromise.then(oldResolve);
                }, 1000);
            } else {
                console.error(err);
                this.disconnect();
            }
        });
        
        this.ws.on('close', () => {
            this.pending.forEach(handler => {
                handler(new Error('disconnected'));
            });
            this.pending = new Map();

            this.disconnect();
        });
    }

    /**
     * Disconnect an agent connection. This is usually only required if a new
     * agent connection has been created and is no longer needed, for example
     * if the `crashListener` in the example at {@link Agent#crashes} is not
     * needed anymore.
     */
    disconnect() {
        this.active = false;
        this.pending = new Map();
        this.ws.close();
    }

    message(message, handler) {
        let send = () => {
            ++this.id;

            let id = this.id;
            this.pending.set(id, handler);
            this.ws.send(JSON.stringify(Object.assign({}, message, {
                'id': id
            })));

            return id;
        };
        
        if (this.connectPromise)
            return this.connectPromise.then(send);

        return send();
    }

    binaryData(id, data) {
        let idBuffer = Buffer.alloc(8, 0);
        idBuffer.writeUInt32LE(id, 0);
        if (data)
            this.ws.send(Buffer.concat([idBuffer, data]));
        else
            this.ws.send(idBuffer);
    }

    command(message) {
        return new Promise((resolve, reject) => {
            this.message(message, (err, message) => {
                if (err)
                    reject(err);
                else
                    resolve(message);

                return true;
            });
        });
    }

    /**
     * Wait for the instance to be ready to use. On iOS, this will wait until Springboard has launched.
     */
    async ready() {
        let results = await this.command({'type': 'app', 'op': 'ready'});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
    }

    /**
     * Uninstalls the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to uninstall.
     * @param {Agent~progressCallback} progress - The progress callback.
     */
    async uninstall(bundleID, progress) {
        return new Promise((resolve, reject) => {
            return this.message({'type': 'app', 'op': 'uninstall', 'bundleID': bundleID}, (err, message) => {
                if (err) {
                    reject(err);
                    return true;
                }

                if (message['success']) {
                    resolve();
                    return true;
                }

                if (message['error']) {
                    reject(Object.assign(new Error(), message['error']));
                    return true;
                }

                if (progress && message['progress'])
                    progress(message['progress'], message['status']);

                return false;
            });
        });
    }

    /**
     * Launches the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to launch.
     */
    async run(bundleID) {
        let results = await this.command({'type': 'app', 'op': 'run', 'bundleID': bundleID});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
    }

    /**
     * Kill the app with the given bundle ID, if it is running.
     * @param {string} bundleID - The bundle ID of the app to kill.
     */
    async kill(bundleID) {
        let results = await this.command({'type': 'app', 'op': 'kill', 'bundleID': bundleID});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
    }

    /**
     * Returns an array of installed apps.
     */
    async appList() {
        let results = await this.command({'type': 'app', 'op': 'list'});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);

        return results['apps'];
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
    install(path, progress) {
        return new Promise((resolve, reject) => {
            return this.message({'type': 'app', 'op': 'install', 'path': path}, (err, message) => {
                if (err) {
                    reject(err);
                    return true;
                }

                if (message['success']) {
                    resolve();
                    return true;
                }

                if (message['error']) {
                    reject(Object.assign(new Error(), message['error']));
                    return true;
                }

                if (progress && message['progress'])
                    progress(message['progress'], message['status']);

                return false;
            });
        });
    }

    async profileList() {
        let results = await this.command({'type': 'profile', 'op': 'list'});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);

        return results['profiles'];
    }

    async installProfile(profile) {
        let results = await this.command({'type': 'profile', 'op': 'install', 'profile': Buffer.from(profile).toString('base64')});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
        return true;
    }

    async removeProfile(profileID) {
        let results = await this.command({'type': 'profile', 'op': 'remove', 'profileID': profileID});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
        return true;
    }

    async getProfile(profileID) {
        let results = await this.command({'type': 'profile', 'op': 'get', 'profileID': profileID});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
        if (!results['profile'])
            return null;
        return new Buffer(results['profile'], 'base64');
    }

    /**
     * Returns a temporary random filename on the VMs filesystem that by the
     * time of invocation of this method is guaranteed to be unique.
     * @see example at {@link Agent#upload}
     */
    async tempFile() {
        let results = await this.command({'type': 'file', 'op': 'temp'});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);

        return results['path'];
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
        return new Promise(async (resolve, reject) => {
            let id = await this.message({'type': 'file', 'op': 'upload', 'path': path}, (err, message) => {
                if (err) {
                    reject(err);
                    return true;
                }

                if (message['success']) {
                    resolve();
                    return true;
                }

                reject(Object.assign(new Error(), message['error']));
                return true;
            });

            stream.on('data', data => {
                this.binaryData(id, data);
            });

            stream.on('end', () => {
                this.binaryData(id);
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
        let s = new DownloadStream();
        this.message({'type': 'file', 'op': 'download', 'path': path}, (err, message) => {
            if (err) {
                reject(err);
                return true;
            }

            if (message['id'] !== undefined) {
                if (message['error']) {
                    reject(Object.assign(new Error(), message['error']));
                    return true;
                }

                return false;
            }

            if (message.length === 0) {
                s.push(null);
                return true;
            }

            s.push(message);
            return false;
        });

        return s;
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
        let results = await this.command({'type': 'file', 'op': 'delete', 'path': path});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);

        return results['path'];
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
    crashes(bundleID, callback) {
        this.message({'type': 'crash', 'op': 'subscribe', 'bundleID': bundleID}, async (err, message) => {
            if (err) {
                callback(err);
                return true;
            }

            let path = message['file'];
            let crashReport = await new Promise(resolve => {
                let stream = this.download(path);
                let buffers = [];

                stream.on('data', data => {
                    buffers.push(data);
                });

                stream.on('end', () => {
                    resolve(Buffer.concat(buffers));
                });
            });

            await this.deleteFile(path);
            callback(null, crashReport.toString('utf8'));
            return false;
        });
    }

    /** Locks the device software-wise. */
    async lockDevice() {
        let results = await this.command({'type': 'system', 'op': 'lock'});
        return results['success'];
    }

    /** Unlocks the device software-wise. */
    async unlockDevice() {
        let results = await this.command({'type': 'system', 'op': 'unlock'});
        if (!results['success'])
            throw Object.assign(new Error(), results['error']);
        return results['success'];
    }
}

module.exports = Agent;
