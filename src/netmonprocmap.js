'use strict'

const WebSocket = require('ws')
const { fetchApi } = require('./util/fetch')

/**
 * @typedef {object} NetmonEntry
 * @property {Object} request
 * @property {Object} response
 * @property {integer} startedDateTime
 * @property {integer} duration
 */

/**
 * A connection to the network monitor process map running on an instance.
 *
 * Instances of this class
 * are returned from {@link Instance#networkMonitorProcessMap} and {@link Instance#newNetworkMonitorProcessMap}. They
 * should not be created using the constructor.
 * @hideconstructor
 */
class NetworkMonitorProcessMap {
  constructor(instance) {
    this.instance = instance
    this.connected = false
    this.connectPromise = null
    this.id = 0
    this.handler = null
    this._keepAliveTimeout = null
    this._lastPong = null
    this._lastPing = null
  }

  /**
   * Ensure the network monitor is connected.
   * @private
   */
  async connect() {
    this.pendingConnect = true
    if (!this.connected) await this.reconnect()
  }

  /**
   * Ensure the network monitor is disconnected, then connect the network monitor.
   * @private
   */
  async reconnect() {
    if (this.connected) this.disconnect()

    if (this.connectPromise) return this.connectPromise

    this.connectPromise = (async () => {
      while (this.pendingConnect) {
        try {
          await this._connect()
          break
        } catch (e) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      this.connectPromise = null
    })()

    return this.connectPromise
  }

  async _connect() {
    const endpoint = await this.instance.netmonprocmapEndpoint()

    // Detect if a disconnection happened before we were able to get the network monitor endpoint.
    if (!this.pendingConnect) throw new Error('connection cancelled')

    let ws = new WebSocket(endpoint)

    this.ws = ws

    ws.on('message', data => {
      try {
        let message
        if (typeof data === 'string') {
          message = JSON.parse(data)
        } else if (data.length >= 8) {
          message = data.slice(8)
        }

        if (this.handler) {
          this.handler(message)
        }
      } catch (err) {
        console.error('error in agent message handler', err)
      }
    })

    ws.on('close', () => {
      this._disconnect()
    })

    await new Promise((resolve, reject) => {
      ws.once('open', () => {
        if (this.ws !== ws) {
          try {
            ws.close()
          } catch (e) {
            // Swallow ws.close() errors.
          }

          reject(new Error('connection cancelled'))
          return
        }

        ws.on('error', err => {
          if (this.ws === ws) {
            this._disconnect()
          } else {
            try {
              ws.close()
            } catch (e) {
              // Swallow ws.close() errors.
            }
          }

          console.error('error in netmonprocmap socket', err)
        })

        resolve()
      })

      ws.once('error', err => {
        if (this.ws === ws) {
          this._disconnect()
        } else {
          try {
            ws.close()
          } catch (e) {
            // Swallow ws.close() errors.
          }
        }

        reject(err)
      })
    })

    this.connected = true
    this._startKeepAlive()
  }

  _startKeepAlive() {
    if (!this.connected) return

    let ws = this.ws

    ws.ping()

    this._keepAliveTimeout = setTimeout(() => {
      if (this.ws !== ws) {
        try {
          ws.close()
        } catch (e) {
          // Swallow ws.close() errors.
        }
        return
      }

      console.error('Netmonprocmap did not get a response to pong in 10 seconds, disconnecting.')

      this._disconnect()
    }, 10000)

    ws.once('pong', async () => {
      if (ws !== this.ws) return

      clearTimeout(this._keepAliveTimeout)
      this._keepAliveTimeout = null

      await new Promise(resolve => setTimeout(resolve, 10000))

      this._startKeepAlive()
    })
  }

  _stopKeepAlive() {
    if (this._keepAliveTimeout) {
      clearTimeout(this._keepAliveTimeout)
      this._keepAliveTimeout = null
    }
  }

  /**
   * Disconnect an network monitor connection. This is usually only required if a new
   * network monitor connection has been created and is no longer needed
   * @example
   * netmon.disconnect();
   */
  disconnect() {
    this.pendingConnect = false
    this._disconnect()
  }

  _disconnect() {
    this.connected = false
    this.handler = null
    this._stopKeepAlive()
    if (this.ws) {
      try {
        this.ws.close()
      } catch (e) {
        // Swallow ws.close() errors.
      }
      this.ws = null
    }
  }

  /** Start Network Monitor Process Map
   * @example
   * let netmon = await instance.newNetworkMonitorProcessMap();
   * netmon.start();
   */
  async start() {
    await this.connect()
    await this._fetch('/netmonprocmap/enable', { method: 'POST' })
    await this.instance._waitFor(() => {
      return this.instance.info.netmonprocmap && this.instance.info.netmonprocmap.enabled
    })
    return true
  }

  /** Set message handler
   * @param {NetworkMonitorProcessMap~newEntryCallback} handler - the callback for captured entry
   * @example
   * let netmonprocmap = await instance.newNetworkMonitorProcessMap();
   * netmonprocmap.handleMessage((message) => {
   *   if (Buffer.isBuffer(message)) {
   *     console.log(message.toString())
   *   } else {
   *     console.log(message)
   *   }
   * });
   */
  handleMessage(handler) {
    this.handler = handler
  }

  /** Clear captured Network Monitor Process Map data
   * @example
   * let netmon = await instance.newNetworkMonitorProcessMap();
   * netmon.clearLog();
   */
  async clearLog() {
    let disconnectAfter = false
    if (!this.connected) {
      await this.connect()
      disconnectAfter = true
    }
    await this.ws.send(JSON.stringify({ type: 'clear' }))
    if (disconnectAfter) {
      await this.disconnect()
    }
  }

  /** Stop Network Monitor Process Map
   * @example
   * let netmonprocmap = await instance.newNetworkMonitorProcessMap();
   * netmonprocmap.stop();
   */
  async stop() {
    await this._fetch('/netmonprocmap/disable', { method: 'POST' })
    await this.disconnect()
    await this.instance._waitFor(() => {
      return !(this.instance.info.netmonprocmap && this.instance.info.netmonprocmap.enabled)
    })
    return (await this.isEnabled()) === false
  }

  /** Check if Network Monitor Process Map is enabled
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
    let info = await fetchApi(this.instance.project, `/instances/${this.instance.id}`)
    return info ? (info.netmonprocmap ? info.netmonprocmap.enabled : false) : false
  }

  async _fetch(endpoint = '', options = {}) {
    return await fetchApi(
      this.instance.project,
      `/instances/${this.instance.id}${endpoint}`,
      options
    )
  }
}

module.exports = NetworkMonitorProcessMap
