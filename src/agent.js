"use strict";

const WebSocket = require("ws");
const stream = require("stream");

/**
 * @typedef {object} CommandResult
 * @property {integer} id - ID
 * @property {boolean} success - command result
 */

/**
 * @typedef {object} FridaPsResult
 * @property {integer} id - ID
 * @property {integer} exit-status -
 * @property {string} output - frida-ps output
 * @property {boolean} success - command result
 */

/**
 * @typedef {object} AppListEntry
 * @property {string} applicationType
 * @property {string} bundleID
 * @property {integer} date
 * @property {integer} diskUsage
 * @property {boolean} isLaunchable
 * @property {string} name
 * @property {boolean} running
 */

/**
 * @typedef {object} StatEntry
 * @property {integer} atime
 * @property {integer} ctime
 * @property {object[]} entries
 * @property {integer} entries[].atime
 * @property {integer} entries[].stime
 * @property {integer} entries[].gid
 * @property {integer} entries[].mode
 * @property {integer} entries[].mtime
 * @property {string} entries[].name
 * @property {integer} entries[].size
 * @property {integer} entries[].uid
 * @property {integer} gid
 * @property {integer} mode
 * @property {integer} mtime
 * @property {string} name
 * @property {integer} size
 * @property {integer} uid
 */

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
        this._keepAliveTimeout = null;
        this._lastPong = null;
        this._lastPing = null;
    }

    /**
     * Ensure the agent is connected.
     * @private
     */
    async connect() {
        this.pendingConnect = true;
        if (!this.connected) await this.reconnect();
    }

    /**
     * Ensure the agent is disconnected, then connect the agent.
     * @private
     */
    async reconnect() {
        if (this.connected) this.disconnect();

        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = (async () => {
            while (this.pendingConnect) {
                try {
                    await this._connect();
                    break;
                } catch (e) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }

            this.connectPromise = null;
        })();

        return this.connectPromise;
    }

    async _connect() {
        this.pending = new Map();

        const endpoint = await this.instance.agentEndpoint();

        // Detect if a disconnection happened before we were able to get the agent endpoint.
        if (!this.pendingConnect) throw new Error("connection cancelled");

        let ws = new WebSocket(endpoint);

        this.ws = ws;

        ws.on("message", (data) => {
            try {
                let message;
                let id;
                if (typeof data === "string") {
                    message = JSON.parse(data);
                    id = message["id"];
                } else if (data.length >= 8) {
                    id = data.readUInt32LE(0);
                    message = data.slice(8);
                }

                let handler = this.pending.get(id);
                if (handler) {
                    // will work regardless of whether handler returns a promise
                    Promise.resolve(handler(null, message)).then((shouldDelete) => {
                        if (shouldDelete) this.pending.delete(id);
                    });
                }
            } catch (err) {
                console.error("error in agent message handler", err);
            }
        });

        ws.on("close", (_code, reason) => {
            this.pending.forEach((handler) => {
                handler(new Error(`disconnected ${reason}`));
            });
            this.pending = new Map();
            this._disconnect();
        });

        await new Promise((resolve, reject) => {
            ws.once("open", () => {
                if (this.ws !== ws) {
                    try {
                        ws.close();
                    } catch (e) {
                        // Swallow ws.close() errors.
                    }

                    reject(new Error("connection cancelled"));
                    return;
                }

                ws.on("error", (err) => {
                    this.pending.forEach((handler) => {
                        handler(err);
                    });
                    this.pending = new Map();

                    if (this.ws === ws) {
                        this._disconnect();
                    } else {
                        try {
                            ws.close();
                        } catch (e) {
                            // Swallow ws.close() errors.
                        }
                    }

                    console.error("error in agent socket", err);
                });

                resolve();
            });

            ws.once("error", (err) => {
                if (this.ws === ws) {
                    this._disconnect();
                } else {
                    try {
                        ws.close();
                    } catch (e) {
                        // Swallow ws.close() errors.
                    }
                }

                reject(err);
            });
        });

        this.connected = true;
        this._startKeepAlive();
    }

    _startKeepAlive() {
        if (!this.connected) return;

        let ws = this.ws;

        ws.ping();

        this._keepAliveTimeout = setTimeout(() => {
            if (this.ws !== ws) {
                try {
                    ws.close();
                } catch (e) {
                    // Swallow ws.close() errors.
                }
                return;
            }

            let err = new Error(
                "Agent did not get a response to ping in 10 seconds, disconnecting.",
            );
            console.error("Agent did not get a response to ping in 10 seconds, disconnecting.");

            this.pending.forEach((handler) => {
                handler(err);
            });
            this.pending = new Map();

            this._disconnect();
        }, 10000);

        ws.once("pong", async () => {
            if (ws !== this.ws) {
                return;
            }

            clearTimeout(this._keepAliveTimeout);
            this._keepAliveTimeout = null;

            await new Promise((resolve) => setTimeout(resolve, 10000));

            this._startKeepAlive();
        });
    }

    _stopKeepAlive() {
        if (this._keepAliveTimeout) {
            clearTimeout(this._keepAliveTimeout);
            this._keepAliveTimeout = null;
        }
    }

    /**
     * Disconnect an agent connection. This is usually only required if a new
     * agent connection has been created and is no longer needed, for example
     * if the `crashListener` in the example at {@link Agent#crashes} is not
     * needed anymore.
     * @example
     * agent.disconnect();
     */
    disconnect() {
        this.pendingConnect = false;
        this._disconnect();
    }

    _disconnect() {
        this.connected = false;
        this._stopKeepAlive();
        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {
                // Swallow ws.close() errors.
            }
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
        if (handler === undefined) handler = (response) => response;

        const id = this.id;
        this.id++;
        const message = Object.assign({ type, op, id }, params);

        await this.connect();
        this.ws.send(JSON.stringify(message)); // TODO handle errors from ws.send
        if (uploadHandler) uploadHandler(id);

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
        if (data) this.ws.send(Buffer.concat([idBuffer, data]));
        else this.ws.send(idBuffer);
    }

    /**
     * Wait for the instance to be ready to use. On iOS, this will wait until Springboard has launched.
     * @example
     * let agent = await instance.agent();
     * await agent.ready();
     */
    async ready() {
        await this.command("app", "ready");
    }

    /**
     * Uninstalls the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to uninstall.
     * @param {Agent~progressCallback} progress - The progress callback.
     * @example
     * await agent.uninstall('com.corellium.demoapp', (progress, status) => {
     *     console.log(progress, status);
     * });
     */
    async uninstall(bundleID, progress) {
        await this.command("app", "uninstall", { bundleID }, (message) => {
            if (message.success) return message;
            if (progress && message.progress) progress(message.progress, message.status);
        });
    }

    /**
     * Launches the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to launch.
     * @example
     * await agent.run("com.corellium.demoapp");
     */
    async run(bundleID) {
        await this.command("app", "run", { bundleID });
    }

    /**
     * Launches the app with the given bundle ID.
     * @param {string} bundleID - The bundle ID of the app to launch, for android this is the package name.
     * @param {string} activity fully qualified activity to launch from bundleID
     * @example
     * await agent.runActivity('com.corellium.test.app', 'com.corellium.test.app/com.corellium.test.app.CrashActivity');
     */
    async runActivity(bundleID, activity) {
        await this.command("app", "run", { bundleID, activity });
    }

    /**
     * Kill the app with the given bundle ID, if it is running.
     * @param {string} bundleID - The bundle ID of the app to kill.
     * @example
     * await agent.kill("com.corellium.demoapp");
     */
    async kill(bundleID) {
        await this.command("app", "kill", { bundleID });
    }

    /**
     * Returns an array of installed apps.
     * @return {Promise<AppListEntry[]>}
     * @example
     * let appList = await agent.appList();
     * for (app of appList) {
     *     console.log('Found installed app ' + app['bundleID']);
     * }
     */
    async appList() {
        const { apps } = await this.command("app", "list");
        return apps;
    }

    /**
     * Gets information about the file at the specified path. Fields are atime, mtime, ctime (in seconds after the epoch), size, mode (see mode_t in man 2 stat), uid, gid. If the path specified is a directory, an entries field will be present with
     * the same structure (and an additional name field) for each immediate child of the directory.
     * @return {Promise<StatEntry>}
     * @example
     * let scripts = await agent.stat('/data/corellium/frida/scripts/');
     */
    async stat(path) {
        const response = await this.command("file", "stat", { path });
        return response.stat;
    }

    /**
     * A callback for file upload progress messages. Can be passed to {@link Agent#upload} and {@link Agent#installFile}
     * @callback Agent~uploadProgressCallback
     * @param {number} bytes - The number of bytes that has been uploaded.
     */

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
        await this.command("app", "install", { path }, (message) => {
            if (message.success) return message;
            if (progress && message.progress) progress(message.progress, message.status);
        });
    }

    async profileList() {
        const { profiles } = await this.command("profile", "list");
        return profiles;
    }

    async installProfile(profile) {
        await this.command("profile", "install", {
            profile: Buffer.from(profile).toString("base64"),
        });
    }

    async removeProfile(profileID) {
        await this.command("profile", "remove", { profileID });
    }

    async getProfile(profileID) {
        const { profile } = await this.command("profile", "get", { profileID });
        if (!profile) return null;
        return new Buffer.from(profile, "base64");
    }

    /**
     * Returns a temporary random filename on the VMs filesystem that by the
     * time of invocation of this method is guaranteed to be unique.
     * @return {Promise<string>}
     * @see example at {@link Agent#upload}
     */
    async tempFile() {
        const { path } = await this.command("file", "temp");
        return path;
    }

    /**
     * Reads from the specified stream and uploads the data to a file on the VM.
     * @param {string} path - The file path to upload the data to.
     * @param {ReadableStream} stream - The stream to read the file data from.
     * @param {Agent~uploadProgressCallback} progress - The callback for install progress information.
     * @example
     * const tmpName = await agent.tempFile();
     * await agent.upload(tmpName, fs.createReadStream('test.ipa'));
     */
    async upload(path, stream, progress) {
        await this.command("file", "upload", { path }, undefined, (id) => {
            let total = 0;

            stream.on("data", (data) => {
                this.sendBinaryData(id, data);
                total += data.length;
                if (progress) progress(total);
            });
            stream.on("end", () => {
                this.sendBinaryData(id);
            });
        });
    }

    /**
     * Downloads the file at the given path from the VM's filesystem. Returns a node ReadableStream.
     * @param {string} path - The path of the file to download.
     * @return {Promise<Readable>}
     * @example
     * const dl = agent.download('/var/tmp/test.log');
     * dl.pipe(fs.createWriteStream('test.log'));
     */
    download(path) {
        let command;
        const agent = this;
        return new stream.Readable({
            read() {
                if (command) return;
                command = agent.command("file", "download", { path }, (message) => {
                    if (!Buffer.isBuffer(message)) return;
                    if (message.length === 0) return true;
                    this.push(message);
                });
                command.then(() => this.push(null)).catch((err) => this.emit("error", err));
            },
        });
    }

    /**
     * Reads a packaged app from the provided stream, uploads the app to the VM
     * using {@link Agent#upload}, and installs it using {@link Agent#install}.
     * @param {ReadableStream} stream - The app to install.
     * @param {Agent~progressCallback} progress - The callback for install progress information.
     * @param {Agent~uploadProgressCallback} progress - The callback for file upload progress information.
     * @example
     * await agent.installFile(fs.createReadStream('test.ipa'), (progress, status) => {
     *     console.log(progress, status);
     * });
     */
    async installFile(stream, progress, uploadProgress) {
        let path = await this.tempFile();
        await this.upload(path, stream, uploadProgress);
        await this.install(path, progress);
    }

    /**
     * Delete the file at the specified path on the VM's filesystem.
     * @param {string} path - The path of the file on the VM's filesystem to delete.
     * @example
     * await agent.deleteFile('/var/tmp/test.log');
     */
    async deleteFile(path) {
        const response = await this.command("file", "delete", { path });
        return response.path;
    }

    /**
     * Change file attributes of the file at the specified path on the VM's filesystem.
     * @param {string} path - The path of the file on the VM's filesystem to delete.
     * @param {Object} attributes - An object whose members and values are the file attributes to change and what to change them to respectively. File attributes path, mode, uid and gid are supported.
     * @return {Promise<CommandResult>}
     * @example
     * await agent.changeFileAttributes(filePath, {mode: 511});
     */
    async changeFileAttributes(path, attributes) {
        const response = await this.command("file", "modify", { path, attributes });
        return response;
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
        await this.command("crash", "subscribe", { bundleID }, async (message) => {
            const path = message.file;
            const crashReport = await new Promise((resolve) => {
                const stream = this.download(path);
                const buffers = [];
                stream.on("data", (data) => {
                    buffers.push(data);
                });
                stream.on("end", () => {
                    resolve(Buffer.concat(buffers));
                });
            });

            await this.deleteFile(path);
            callback(null, crashReport.toString("utf8"));
        });
    }

    /** Locks the device software-wise.
     * @example
     * agent.lockDevice();
     */
    async lockDevice() {
        await this.command("system", "lock");
    }

    /** Unlocks the device software-wise.
     * @example
     * agent.unlockDevice();
     */
    async unlockDevice() {
        await this.command("system", "unlock");
    }

    /** Shuts down the device.
     * @example
     * agent.shutdown();
     */
    async shutdown() {
        await this.command("system", "shutdown");
    }

    async acquireDisableAutolockAssertion() {
        await this.command("system", "acquireDisableAutolockAssertion");
    }

    async releaseDisableAutolockAssertion() {
        await this.command("system", "releaseDisableAutolockAssertion");
    }

    /** Connect device to WiFi.
     * @example
     * await agent.connectToWifi();
     */
    async connectToWifi() {
        await this.command("wifi", "connect");
    }

    /** Disconnect device from WiFi.
     * @example
     * await agent.disconnectFromWifi();
     */
    async disconnectFromWifi() {
        await this.command("wifi", "disconnect");
    }

    /** Get device property. */
    async getProp(property) {
        return await this.command("system", "getprop", { property });
    }

    /** Get device network infor
     * @example
     * let info = await agent.network();
     * console.log(info);
     */
    async network() {
        await this.command("system", "network");
    }

    /**
     * Run frida on the device.
     * @param {integer} pid
     * @param {string} name
     * @return {Promise<CommandResult>}
     * @example
     * await agent.runFrida(449, 'keystore');
     */
    async runFrida(pid, name) {
        return await this.command("frida", "run-frida", {
            target_pid: pid.toString(),
            target_name: name.toString(),
        });
    }

    /**
     * Run frida-ps on the device and return the command's output.
     * @return {Promise<FridaPsResult>}
     * @example
     * let procList = await agent.runFridaPs();
     * let lines = procList.output.trim().split('\n');
     * lines.shift();
     * lines.shift();
     * for (const line of lines) {
     *     const [pid, name] = line.trim().split(/\s+/);
     *     console.log(pid, name);
     * }
     */
    async runFridaPs() {
        return await this.command("frida", "run-frida-ps");
    }

    /**
     * Run frida-kill on the device.
     * @return {Promise<CommandResult>}
     * @example
     * await agent.runFridaKill();
     */
    async runFridaKill() {
        return await this.command("frida", "run-frida-kill");
    }
}

module.exports = Agent;
