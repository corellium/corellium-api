"use strict";

const WebSocket = require("ws");
const { fetchApi } = require("./util/fetch");

/**
 * @typedef {object} NetmonEntry
 * @property {Object} request
 * @property {Object} response
 * @property {integer} startedDateTime
 * @property {integer} duration
 */

/**
 * A connection to the network monitor running on an instance.
 *
 * Instances of this class
 * are returned from {@link Instance#networkMonitor} and {@link Instance#newNetworkMonitor}. They
 * should not be created using the constructor.
 * @hideconstructor
 */
class NetworkMonitor {
    constructor(instance) {
        this.instance = instance;
        this.connected = false;
        this.connectPromise = null;
        this.id = 0;
        this.handler = null;
        this._keepAliveTimeout = null;
        this._lastPong = null;
        this._lastPing = null;
    }

    /**
     * A callback for file upload progress messages. Can be passed to {@link NetworkMonitor#handleMessage}
     * @callback NetworkMonitor~newEntryCallback
     * @param {NetmonEntry} entry - {@link NetmonEntry} object.
     * @example
     * let netmon = await instance.newNetworkMonitor();
     * netmon.handleMessage((message) => {
     *     let host = message.request.headers.find(entry => entry.key === 'Host');
     *     console.log(message.response.status, message.request.method, message.response.body.size, host.value);
     * });
     */

    /**
     * Ensure the network monitor is connected.
     * @private
     */
    async connect() {
        this.pendingConnect = true;
        if (!this.connected) await this.reconnect();
    }

    /**
     * Ensure the network monitor is disconnected, then connect the network monitor.
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
        const endpoint = await this.instance.netmonEndpoint();

        // Detect if a disconnection happened before we were able to get the network monitor endpoint.
        if (!this.pendingConnect) throw new Error("connection cancelled");

        let ws = new WebSocket(endpoint);

        this.ws = ws;

        ws.on("message", (data) => {
            try {
                let message;
                if (typeof data === "string") {
                    message = JSON.parse(data);
                } else if (data.length >= 8) {
                    message = data.slice(8);
                }

                if (this.handler) {
                    this.handler(message);
                }
            } catch (err) {
                console.error("error in agent message handler", err);
            }
        });

        ws.on("close", () => {
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
                    if (this.ws === ws) {
                        this._disconnect();
                    } else {
                        try {
                            ws.close();
                        } catch (e) {
                            // Swallow ws.close() errors.
                        }
                    }

                    console.error("error in netmon socket", err);
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

            console.error("Netmon did not get a response to pong in 10 seconds, disconnecting.");

            this._disconnect();
        }, 10000);

        ws.once("pong", async () => {
            if (ws !== this.ws) return;

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
     * Disconnect an network monitor connection. This is usually only required if a new
     * network monitor connection has been created and is no longer needed
     * @example
     * netmon.disconnect();
     */
    disconnect() {
        this.pendingConnect = false;
        this._disconnect();
    }

    _disconnect() {
        this.connected = false;
        this.handler = null;
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

    /** Start Network Monitor
     * @example
     * let netmon = await instance.newNetworkMonitor();
     * netmon.start();
     */
    async start() {
        await this.connect();
        await this._fetch("/sslsplit/enable", { method: "POST" });
        while (!(await this.isEnabled()));

        return true;
    }

    /** Set message handler
     * @param {NetworkMonitor~newEntryCallback} handler - the callback for captured entry
     * @example
     * let netmon = await instance.newNetworkMonitor();
     * netmon.handleMessage((message) => {
     *     let host = message.request.headers.find(entry => entry.key === 'Host');
     *     console.log(message.response.status, message.request.method, message.response.body.size, host.value);
     * });
     */
    async handleMessage(handler) {
        this.handler = handler;
    }

    /** Clear captured Network Monitor data
     * @example
     * let netmon = await instance.newNetworkMonitor();
     * netmon.clearLog();
     */
    async clearLog() {
        let disconnectAfter = false;
        if (!this.connected) {
            await this.connect();
            disconnectAfter = true;
        }
        await this.ws.send(JSON.stringify({ type: "clear" }));
        if (disconnectAfter) {
            await this.disconnect();
        }
    }

    /** Stop Network Monitor
     * @example
     * let netmon = await instance.newNetworkMonitor();
     * netmon.stop();
     */
    async stop() {
        await this._fetch("/sslsplit/disable", { method: "POST" });
        await this.disconnect();
        return (await this.isEnabled()) === false;
    }

    /** Check if Network Monitor is enabled
     * @returns {boolean}
     * @example
     * let enabled = await netmon.isEnabled();
     * if (enabled) {
     *     console.log("enabled");
     * } else {
     *     console.log("disabled");
     * }
     */
    async isEnabled() {
        let info = await fetchApi(this.instance.project, `/instances/${this.instance.id}`);
        return info ? (info.netmon ? info.netmon.enabled : false) : false;
    }

    async _fetch(endpoint = "", options = {}) {
        return await fetchApi(
            this.instance.project,
            `/instances/${this.instance.id}${endpoint}`,
            options,
        );
    }
}

module.exports = NetworkMonitor;
