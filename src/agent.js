"use strict";

const WebSocket = require("ws");
const stream = require("stream");

const { sleep } = require("./util/sleep");

/**
 * @typedef {object} CommandResult
 * @property {integer} id - ID
 * @property {boolean} success - command result
 */

/**
 * @typedef {object} ShellExecResult
 * @property {integer} id - ID
 * @property {integer} exit-status
 * @property {string} output - command output
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
 * @typedef {object} ProvisioningProfileInfo
 * @property {string} name
 * @property {string} uuid
 * @property {string} teamId
 * @property {string[]} certs
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
        this.uploading = false;
        this.connectPromise = null;
        this.id = 0;
        this._keepAliveTimeout = null;
        this._startKeepAliveTimeout = null;
        this._lastPong = null;
        this._lastPing = null;
    }

    /**
     * Ensure the agent is connected.
     * @private
     */
    async connect() {
        this.pendingConnect = true;
        if (!this.connected) {
            return await this.reconnect();
        }
    }

    /**
     * Ensure the agent is disconnected, then connect the agent.
     * @private
     */
    async reconnect() {
        if (this.connected) this.disconnect();

        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = await (async () => {
            while (this.pendingConnect) {
                try {
                    await this._connect();
                    break;
                } catch (err) {
                    if (err.stack.includes("Instance likely does not exist")) {
                        throw err;
                    }
                    if (err.stack.includes("unexpected server response (502)")) {
                        // 'Error: unexpected server response (502)' means the device is not likely up yet
                        await sleep(10 * 1000);
                    }
                    if (err.stack.includes("closed before the connection")) {
                        // Do nothing this is normal when trying to settle a connection for a vm coming up
                    } else {
                        await sleep(7.5 * 1000);
                    }
                }
            }

            this.connectPromise = null;
        })();

        return this.connectPromise;
    }

    async _connect() {
        this.pending = new Map();

        const endpoint = await this.instance.agentEndpoint();
        if (!endpoint) {
            this.pendingConnect = false;
            throw new Error("Instance likely does not exist");
        }

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

        ws.on("close", (code, _reason) => {
            this.pending.forEach((handler) => {
                handler(new Error(`disconnected with code ${code}`));
            });
            this.pending = new Map();
            this._disconnect();
        });

        return await new Promise((resolve, reject) => {
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
        })
            .then(() => {
                this.pendingConnect = false;
                this.connected = true;
                clearTimeout(this._startKeepAliveTimeout);
                this._startKeepAlive();
            })
            .catch(async (err) => {
                await this.instance.update();
                throw err;
            });
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
        }, 10 * 1000);

        ws.once("pong", async () => {
            if (ws !== this.ws) {
                return;
            }

            clearTimeout(this._keepAliveTimeout);
            this._keepAliveTimeout = null;

            if (!this.uploading) {
                this._startKeepAliveTimeout = setTimeout(this._startKeepAlive, 10 * 1000);
            }
        });
    }

    _stopKeepAlive() {
        if (this._startKeepAliveTimeout) {
            clearTimeout(this._startKeepAliveTimeout);
            this._startKeepAliveTimeout = null;
        }
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

        while (!this.ws) {
            await this.connect();
        }
        this.ws.send(JSON.stringify(message));
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
     * Executes a given command
     * @param {string} cmd - The cmd to execute
     * @return {Promise<ShellExecResult>}
     * @example
     * await agent.shellExec("uname");
     */
    async shellExec(cmd) {
        return await this.command("app", "shellExec", { cmd });
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

    /**
     * Returns an array of Mobile Configuration profile IDs
     * @return {Promise<string[]>}
     * @example
     * let profiles = await agent.profileList();
     * for (p of profiles) {
     *     console.log('Found configuration profile: ' + p);
     * }
     */
    async profileList() {
        const { profiles } = await this.command("profile", "list");
        return profiles;
    }

    /**
     * Installs Mobile Configuration profile
     * @param {Buffer} profile - profile binary
     * @example
     * var profile = fs.readFileSync(path.join(__dirname, "myprofile.mobileconfig"));
     * await agent.installProfile(profile);
     */
    async installProfile(profile) {
        await this.command("profile", "install", {
            profile: Buffer.from(profile).toString("base64"),
        });
    }

    /**
     * Deletes Mobile Configuration profile
     * @param {string} profileID - profile ID
     * @example
     * await agent.removeProfile('com.test.myprofile');
     */
    async removeProfile(profileID) {
        await this.command("profile", "remove", { profileID });
    }

    /**
     * Gets Mobile Configuration profile binary
     * @param {string} profileID - profile ID
     * @return {Promise<Buffer>}
     * @example
     * var profile = await agent.getProfile('com.test.myprofile');
     */
    async getProfile(profileID) {
        const { profile } = await this.command("profile", "get", { profileID });
        if (!profile) return null;
        return new Buffer.from(profile, "base64");
    }

    /**
     * Returns an array of Provisioning profile descriptions
     * @return {Promise<ProvisioningProfileInfo[]>}
     * @example
     * let profiles = await agent.listProvisioningProfiles();
     * for (p of profiles) {
     *     console.log(p['uuid']);
     * }
     */
    async listProvisioningProfiles() {
        const { profiles } = await this.command("provisioning", "list");
        return profiles;
    }

    /**
     * Installs Provisioning profile
     * @param {Buffer} profile - profile binary
     * @param {Boolean} trust - immediately trust installed profile
     * @example
     * var profile = fs.readFileSync(path.join(__dirname, "embedded.mobileprovision"));
     * await agent.installProvisioningProfile(profile, true);
     */
    async installProvisioningProfile(profile, trust = false) {
        await this.command("provisioning", "install", {
            profile: Buffer.from(profile).toString("base64"),
            trust: trust,
        });
    }

    /**
     * Deletes Provisioning profile
     * @param {string} profileID - profile ID
     * @example
     * await agent.removeProvisioningProfile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
     */
    async removeProvisioningProfile(profileID) {
        await this.command("provisioning", "remove", {
            uuid: profileID,
        });
    }

    /**
     * Approves (makes trusted) profile which will be installed later in a future for example during app installation via Xcode.
     * @param {string} certID - profile ID
     * @param {string} profileID - profile ID
     * @example
     * await agent.preApproveProvisioningProfile('Apple Development: my@email.com (NKJDZ3DZJB)', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
     */
    async preApproveProvisioningProfile(certID, profileID) {
        await this.command("provisioning", "preapprove", {
            cert: certID,
            uuid: profileID,
        });
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
        // Temporarily stop the keepalive as the upload appears to backlog
        // the control packets (ping/pong) at the proxy which can cause issues
        // and a disconnect
        this._stopKeepAlive();
        this.uploading = true;
        await this.command(
            "file",
            "upload",
            { path },
            (message) => {
                // This is hit after the upload is completed and the agent
                // on the other end sends the reply packet of success/fail
                // Restart the keepalive as the upload buffer should be cleared
                clearTimeout(this._startKeepAliveTimeout);
                this._startKeepAlive();
                this.uploading = false;

                // Pass back the message to the command() function to prevent
                // blocking or returning an invalid value
                return message;
            },
            (id) => {
                let total = 0;

                stream.on("data", (data) => {
                    this.sendBinaryData(id, data);
                    total += data.length;
                    if (progress) progress(total);
                });
                stream.on("end", () => {
                    this.sendBinaryData(id);
                });
            },
        );
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
     * @param {ReadableStream} stream - The app to install, the stream will be closed after it is uploaded.
     * @param {Agent~progressCallback} installProgress - The callback for install progress information.
     * @param {Agent~uploadProgressCallback} uploadProgress - The callback for file upload progress information.
     * @example
     * await agent.installFile(fs.createReadStream('test.ipa'), (installProgress, installStatus) => {
     *     console.log(installProgress, installStatus);
     * });
     */
    async installFile(stream, installProgress, uploadProgress) {
        let path = await this.tempFile();

        await this.upload(path, stream, uploadProgress);
        stream.on("close", () => {
            stream.destroy();
        });

        await this.install(path, installProgress);

        try {
            await this.stat(path);
            await this.deleteFile(path);
        } catch (err) {
            if (!err.message.includes("Stat of file")) {
                throw err;
            }
        }
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
     * await agent.lockDevice();
     */
    async lockDevice() {
        await this.command("system", "lock");
    }

    /** Unlocks the device software-wise.
     * @example
     * awaitagent.unlockDevice();
     */
    async unlockDevice() {
        await this.command("system", "unlock");
    }

    /** Enables UI Automation.
     * @example
     * await agent.enableUIAutomation();
     */
    async enableUIAutomation() {
        await this.command("system", "enableUIAutomation");
    }

    /** Disables UI Automation.
     * @example
     * await agent.disableUIAutomation();
     */
    async disableUIAutomation() {
        await this.command("system", "disableUIAutomation");
    }

    /** Checks if SSL pinning is enabled. By default SSL pinning is disabled.
     * @returns {boolean}
     * @example
     * let enabled = await agent.isSSLPinningEnabled();
     * if (enabled) {
     *     console.log("enabled");
     * } else {
     *     console.log("disabled");
     * }
     */
    async isSSLPinningEnabled() {
        return (await this.command("system", "isSSLPinningEnabled")).enabled;
    }

    /** Enables SSL pinning.
     * @example
     * await agent.enableSSLPinning();
     */
    async enableSSLPinning() {
        await this.command("system", "enableSSLPinning");
    }

    /** Disables SSL pinning.
     * @example
     * await agent.disableSSLPinning();
     */
    async disableSSLPinning() {
        await this.command("system", "disableSSLPinning");
    }

    /** Shuts down the device.
     * @example
     * await agent.shutdown();
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

    /**
     * Run frida on the device.
     * Please note that both arguments (pid and name) need to be provided as they are required by the Web UI.
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
