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
 * A connection to netdump running on an instance.
 *
 * Instances of this class
 * are returned from {@link Instance#netdump} and {@link Instance#newNetdump}. They
 * should not be created using the constructor.
 * @hideconstructor
 */
class Netdump {
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
   * Ensure netdump is connected.
   * @private
   */
  async connect() {
    this.pendingConnect = true
    if (!this.connected) await this.reconnect()
  }

  /**
   * Ensure netdump is disconnected, then connect netdump.
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
    const endpoint = await this.instance.netdumpEndpoint()

    // Detect if a disconnection happened before we were able to get netdump endpoint.
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

          console.error('error in netdump socket', err)
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

      console.error('Netdump did not get a response to pong in 10 seconds, disconnecting.')

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
   * Disconnect netdump connection. This is usually only required if a new
   * netdump connection has been created and is no longer needed
   * @example
   * netdump.disconnect();
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

  /** Start netdump
   * @example
   * let netdump = await instance.newNetdump();
   * netdump.start();
   */
  async start() {
    await this.connect()
    await this._fetch('/netdump/enable', { method: 'POST' })
    await this.instance._waitFor(() => {
      return this.instance.info.netdump && this.instance.info.netdump.enabled
    })
    return true
  }

  /** Set message handler
   * @param {NetworkMonitorProcessMap~newEntryCallback} handler - the callback for captured entry
   * @example
   * let netdump = await instance.newNetdump();
   * netdump.handleMessage((message) => {
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

  /** Clear captured netdump data
   * @example
   * let netdump = await instance.newNetdump();
   * netdump.clearLog();
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

  /** Stop Netdump
   * @example
   * let netdump = await instance.newNetdump();
   * netdump.stop();
   */
  async stop() {
    await this._fetch('/netdump/disable', { method: 'POST' })
    await this.disconnect()
    await this.instance._waitFor(() => {
      return !(this.instance.info.netdump && this.instance.info.netdump.enabled)
    })
    return (await this.isEnabled()) === false
  }

  /** Check if netdump is enabled
   * @returns {boolean}
   * @example
   * let enabled = await netdump.isEnabled();
   * if (enabled) {
   *     console.log("enabled");
   * } else {
   *     console.log("disabled");
   * }
   */
  async isEnabled() {
    let info = await fetchApi(this.instance.project, `/instances/${this.instance.id}`)
    return info ? (info.netdump ? info.netdump.enabled : false) : false
  }

  async _fetch(endpoint = '', options = {}) {
    return await fetchApi(
      this.instance.project,
      `/instances/${this.instance.id}${endpoint}`,
      options
    )
  }
}

module.exports = Netdump
