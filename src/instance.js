'use strict'

const { fetchApi } = require('./util/fetch')
const EventEmitter = require('events')
const wsstream = require('websocket-stream')
const Snapshot = require('./snapshot')
const Agent = require('./agent')
const WebPlayer = require('./webplayer')
const Images = require('./images')
const pTimeout = require('p-timeout')
const NetworkMonitor = require('./netmon')
const Netdump = require('./netdump')
const { sleep } = require('./util/sleep')
const util = require('util')
const fs = require('fs')
const { compress, uploadFile } = require('./images')
const { v4: uuidv4 } = require('uuid')
const split = require('split')

/**
 * @typedef {object} ThreadInfo
 * @property {string} pid - process PID
 * @property {string} kernelId - process ID in kernel
 * @property {string} name - process name
 * @property {object[]} threads - process threads
 * @property {string} threads[].tid - thread ID
 * @property {string} threads[].kernelId - thread ID in kernel
 */

/**
 * @typedef {object} PanicInfo
 * @property {integer} flags
 * @property {string} panic
 * @property {string} stackshot
 * @property {string} other
 * @property {integer} ts
 */

/**
 * @typedef {object} PeripheralData
 * @property {string} gpsToffs - GPS time offset
 * @property {string} gpsLat - GPS latitude
 * @property {string} gpsLon - GPS longitude
 * @property {string} gpsAlt - GPS altitude
 * @property {string} acOnline - Is AC charger present, options ['0' , '1']
 * @property {string} batteryPresent - Is battery present, options ['0' , '1']
 * @property {string} batteryStatus - Battery charging status, options ['charging', 'discharging', 'not-charging']
 * @property {string} batteryHealth - Battery health, options ['good', 'overheat', 'dead', 'overvolt', 'failure']
 * @property {string} batteryCapacity - Battery capacity, options 0-100
 * @property {string} acceleration - Acceleration sensor
 * @property {string} gyroscope - Gyroscope sensor
 * @property {string} magnetic - Magnetic sensor
 * @property {string} orientation - Orientation sensor
 * @property {string} temperature - Temperator sensor
 * @property {string} proximity - Proximity sensor
 * @property {string} light - Light sensor
 * @property {string} pressure - Pressure sensor
 * @property {string} humidity - Humidity sensor
 */

/**
 * @typedef {object} RateInfo
 * Convert microcents to USD using rate / 1000000 / 100 * seconds where rate is rateInfo.onRateMicrocents or rateInfo.offRateMicrocents and seconds is the number of seconds the instance is running.
 * @property {integer} onRateMicrocents - The amount per second, in microcents (USD), that this instance charges to be running.
 * @property {integer} offRateMicrocents - The amount per second, in microcents (USD), that this instance charges to be stored.
 */

/**
 * Instances of this class are returned from {@link Project#instances}, {@link
 * Project#getInstance}, and {@link Project#createInstance}. They should not be
 * created using the constructor.
 * @hideconstructor
 */
class Instance extends EventEmitter {
  constructor (project, info) {
    super()

    this.project = project
    this.info = info
    this.infoDate = new Date()
    this.id = info.id
    this.updating = false

    this.hash = null
    this.hypervisorStream = null
    this._agent = null
    this._netmon = null
    this._webplayer = null
    this.lastPanicLength = null
    this.volumeId = null

    this.on('newListener', event => {
      if (event === 'change') {
        this.project.updater.add(this)
      }
    })
    this.on('removeListener', event => {
      if (event === 'change' && this.listenerCount('change') === 0) {
        this.project.updater.remove(this)
      }
    })
  }

  /**
   * The instance name.
   */
  get name () {
    return this.info.name
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
   * `deleted`|The instance is deleted, instance will set to undefined.
   * `paused`|The instance is paused.
   *
   * A full list of possible values is available in the API documentation.
   */
  get state () {
    return this.info.state
  }

  /**
   * The timestamp when the state last changed.
   */
  get stateChanged () {
    return this.info.stateChanged
  }

  /**
   * The instance flavor, such as `iphone6`.
   */
  get flavor () {
    return this.info.flavor
  }

  /**
   * The instance type, such as `ios`.
   */
  get type () {
    return this.info.type
  }

  /**
   * The pending task that is being requested by the user and is being executed by the backend.
   * This field is null when no tasks are pending. The returned object has two fields: name and options.
   *
   * Current options for name are start, stop, pause, unpause, snapshot, revert.
   * For start and revert, options.bootOptions contains the boot options the instance is to be started with.
   *
   */
  get userTask () {
    return this.info.userTask
  }

  /**
   * Return the current task state.
   */
  get taskState () {
    return this.info.taskState
  }

  /**
   * Rename an instance.
   * @param {string} name - The new name of the instance.
   * @example <caption>Renaming the first instance named `foo` to `bar`</caption>
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.rename('bar');
   */
  async rename (name) {
    await this._fetch('', {
      method: 'PATCH',
      json: { name }
    })
  }

  /**
   * The instance boot options.
   */
  get bootOptions () {
    return this.info.bootOptions
  }

  /**
   * Change boot options for an instance.
   * @param {Object} bootOptions - The new boot options for the instance.
   * @example <caption>Changing the boot arguments for the instance.</caption>
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.modifyBootOptions(Object.assign({}, instance.bootOptions, {bootArgs: 'new-boot-args'}));
   */
  async modifyBootOptions (bootOptions) {
    await this._fetch('', {
      method: 'PATCH',
      json: { bootOptions }
    })
  }

  /**
   * Change device peripheral/sensor values.
   *
   * Currently available for Android only.
   * @param {PeripheralData} peripheralData - The new peripheral options for the instance.
   * @example <caption>Changing the sensor values for the instance.</caption>
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.modifyPeripherals({
   *     "gpsToffs": "0.000000",
   *     "gpsLat": "37.414300",
   *     "gpsLon": "-122.077400",
   *     "gpsAlt": "45.000000",
   *     "acOnline": "1",
   *     "batteryPresent": "1",
   *     "batteryStatus": "discharging",
   *     "batteryHealth": "overheat",
   *     "batteryCapacity": "99.000000",
   *     "acceleration": "0.000000,9.810000,0.000000",
   *     "gyroscope": "0.000000,0.000000,0.000000",
   *     "magnetic": "0.000000,45.000000,0.000000",
   *     "orientation": "0.000000,0.000000,0.000000",
   *     "temperature": "25.000000",
   *     "proximity": "50.000000",
   *     "light": "20.000000",
   *     "pressure": "1013.250000",
   *     "humidity": "55.000000"
   * }));
   */
  async modifyPeripherals (peripheralData) {
    await this._fetch('', {
      method: 'PATCH',
      json: { peripherals: peripheralData }
    })
  }

  /**
   * Get peripheral/sensor data
   * @return {Promise<PeripheralData>}
   * @example
   * let peripherals = await instance.getPeripherals();
   */
  async getPeripherals () {
    return await this._fetch('/peripherals', { method: 'GET' })
  }

  /**
   * Return an array of this instance's {@link Snapshot}s.
   * @returns {Snapshot[]} This instance's snapshots
   * @example
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.snapshots();
   */
  async snapshots () {
    const snapshots = await this._fetch('/snapshots')
    return snapshots.map(snap => new Snapshot(this, snap))
  }

  /**
   * Take a new snapshot of this instance.
   * @param {string} name - The name for the new snapshot.
   * @returns {Snapshot} The new snapshot
   * @example
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.takeSnapshot("TestSnapshot");
   */
  async takeSnapshot (name) {
    const snapshot = await this._fetch('/snapshots', {
      method: 'POST',
      json: { name }
    })
    await this.update()
    await this.waitForUserTask(null)

    return new Snapshot(this, snapshot)
  }

  /**
   * Returns a dump of this instance's serial port log.
   * @return {string}
   * @example
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * console.log(await instance.consoleLog());
   */
  async consoleLog () {
    const response = await this._fetch('/consoleLog', { response: 'raw' })
    return await response.text()
  }

  /**
   * Return an array of recorded kernel panics.
   * @return {Promise<PanicInfo[]>}
   * @example
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * console.log(await instance.panics());
   */
  async panics () {
    return await this._fetch('/panics')
  }

  /**
   * Clear the recorded kernel panics of this instance.
   * @example
   * const instances = await project.instances();
   * const instance = instances.find(instance => instance.name == 'foo');
   * await instance.clearPanics();
   */
  async clearPanics () {
    await this._fetch('/panics', { method: 'DELETE' })
  }

  /**
   * Return an {@link Agent} connected to this instance. Calling this
   * method multiple times will reuse the same agent connection.
   * @returns {Agent}
   * @example
   * let agent = await instance.agent();
   * await agent.ready();
   */
  async agent () {
    if (this._agent && !this._agent.connected && !this._agent.pendingConnect) {
      this._agent.disconnect()
      delete this._agent
    }

    if (!this._agent) {
      this._agent = await this.newAgent()
    }

    return this._agent
  }

  async agentEndpoint () {
    // Extra while loop to avoid races where info.agent gets unset again before we wake back up.
    while (!this.info.agent) await this._waitFor(() => !!this.info.agent)

    // We want to avoid a situation where we were not listening for updates, and the info we have is stale (from last boot),
    // and the instance has started again but this time with no agent info yet or new agent info. Therefore, we can use
    // cached if only if it's recent.
    if (new Date().getTime() - this.infoDate.getTime() > 2 * this.project.updater.updateInterval) {
      try {
        await this.update()
      } catch (err) {
        if (err.stack.includes('500 Internal Server Error')) {
          return undefined
        }
      }
    }

    return this.project.api + '/agent/' + this.info.agent.info
  }

  async waitForAgentReady () {
    let agentObtained
    do {
      try {
        const endpoint = await this.agentEndpoint()
        if (!endpoint) throw new Error('Instance likely does not exist')

        const agent = await this.agent()

        agentObtained = await pTimeout(
          (async () => {
            try {
              await agent.ready()
              return true
            } catch (e) {
              // If the websocket threw an error, lets wait for the end of
              // the timeout to give it some breathing room
              await sleep(2 * 1000)
            } finally {
              agent.disconnect()
            }
          })(),
          20 * 1000,
          async () => {
            // When this times out, it is likely that the instance isn't fully up yet
            await sleep(5 * 1000)
            return false
          }
        )
      } catch (e) {
        console.log(`Caught error waiting for agent to be ready ${e}`)
        if (e.stack.includes('Instance likely does not exist')) {
          throw e
        }
      }
    } while (!agentObtained)
  }

  /**
   * Create a new {@link Agent} connection to this instance. This is
   * useful for agent tasks that don't finish and thus consume the
   * connection, such as {@link Agent#crashes}.
   * @returns {Agent}
   * @example
   * let crashListener = await instance.newAgent();
   * crashListener.crashes('com.corellium.demoapp', (err, crashReport) => {
   *     if (err) {
   *         console.error(err);
   *         return;
   *     }
   *     console.log(crashReport);
   * });
   */
  async newAgent () {
    return new Agent(this)
  }

  /**
   * Return {@link Netdump} connected to this instance. Calling this
   * method multiple times will reuse the same agent connection.
   * @returns {Netdump}
   */
  async netdump () {
    if (!this._netdump) this._netdump = await this.newNetdump()
    return this._netdump
  }

  async netdumpEndpoint () {
    // Extra while loop to avoid races where info.netdump gets unset again before we wake back up.
    while (!this.info.netdump) await this._waitFor(() => !!this.info.netdump)

    // We want to avoid a situation where we were not listening for updates, and the info we have is stale (from last boot),
    // and the instance has started again but this time with no agent info yet or new agent info. Therefore, we can use
    // cached if only if it's recent.
    if (new Date().getTime() - this.infoDate.getTime() > 2 * this.project.updater.updateInterval) {
      try {
        await this.update()
      } catch (err) {
        if (err.stack.includes('500 Internal Server Error')) {
          return undefined
        }
      }
    }

    return this.project.api + '/agent/' + this.info.netdump.info
  }

  /**
   * Create a new {@link Netdump} connection to this instance.
   * @returns {Netdump}
   */
  async newNetdump () {
    return new Netdump(this)
  }

  /**
   * Download specified pcap file.  If pcapFile is not given or is invalid, default to netdump.pcap
   * @example
   * const pcap = await instance.downloadPcap();
   * console.log(pcap.toString());
   */
  async downloadPcap (pcapFile) {
    const availablePcaps = {
      networkMonitor: { preAuth: '/networkMonitorPcap-authorize', pcapFile: 'networkMonitor.pcap' },
      netdump: { preAuth: '/netdumpPcap-authorize', pcapFile: 'netdump.pcap' }
    }

    const pcap = (typeof pcapFile === 'string' && availablePcaps[pcapFile]) || availablePcaps.netdump
    const token = await this._fetch(pcap.preAuth, { method: 'POST' })
    const response = await fetchApi(this.project, `/preauthed/${token.token}/${pcap.pcapFile}`, { response: 'raw' })

    return await response.buffer()
  }

  /**
   * Return an {@link NetworkMonitor} connected to this instance. Calling this
   * method multiple times will reuse the same agent connection.
   * @returns {Promise<NetworkMonitor>}
   */
  async networkMonitor () {
    if (!this._netmon) this._netmon = await this.newNetworkMonitor()
    return this._netmon
  }

  async netmonEndpoint () {
    // Extra while loop to avoid races where info.netmon gets unset again before we wake back up.
    while (!this.info.netmon) await this._waitFor(() => !!this.info.netmon)

    // We want to avoid a situation where we were not listening for updates, and the info we have is stale (from last boot),
    // and the instance has started again but this time with no agent info yet or new agent info. Therefore, we can use
    // cached if only if it's recent.
    if (new Date().getTime() - this.infoDate.getTime() > 2 * this.project.updater.updateInterval) {
      try {
        await this.update()
      } catch (err) {
        if (err.stack.includes('500 Internal Server Error')) {
          return undefined
        }
      }
    }

    return this.project.api + '/agent/' + this.info.netmon.info
  }

  /**
   * Create a new {@link NetworkMonitor} connection to this instance.
   * @returns {NetworkMonitor}
   */
  async newNetworkMonitor () {
    return new NetworkMonitor(this)
  }

  /**
   * Returns a bidirectional node stream for this instance's serial console.
   * @return {WebSocket-Stream}
   * @example
   * const consoleStream = await instance.console();
   * consoleStream.pipe(process.stdout);
   */
  async console () {
    const { url } = await this._fetch('/console')
    return wsstream(url, ['binary'])
  }

  /**
   * Waits for a specified line on console.
   * @example
   * await instance.waitForLineOnConsole(line)
   */
  async waitForLineOnConsole (line) {
    const stream = await this.console()
    await stream
      .pipe(split())
      .on('data', l => {
        if (l === line) {
          stream.destroy()
        }
      })
      .on('end', () => {

      })
  }

  /**
   * Returns the cost, in microcents, for the instance in the on and off state. Instances are charged $0.25 / day for storage (off) and $0.25 per core per hour (on).
   * @returns {RateInfo}
   * @example
   * const rateInfo = await instance.rate();
   */
  async rate () {
    return await this._fetch('/rate')
  }

  /**
   * Send an input to this instance.
   * @param {Input} input - The input to send.
   * @see Input
   * @example
   * await instance.sendInput(I.pressRelease('home'));
   */
  async sendInput (input) {
    await this._fetch('/input', { method: 'POST', json: input.points })
  }

  /**
   * @typedef {object} StartOptions
   * @property {boolean} sockcap - Start the sockcap add-on extension if loaded
   * @property {boolean} paused - Start the instance in a paused state
   */

  /**
   * Start this instance.
   * @param {StartOptions} options
   * @example
   * await instance.start({
   *  sockcap: true,
   *  paused: true
   * });
   */
  async start (options) {
    await this._fetch('/start', { method: 'POST' }, options)
  }

  /**
   * Stop this instance.
   * @example
   * await instance.stop();
   */
  async stop () {
    await this._fetch('/stop', { method: 'POST' })
  }

  /**
   * Pause this instance
   * @example
   * await instance.pause();
   */
  async pause () {
    await this._fetch('/pause', { method: 'POST' })
  }

  /**
   * Unpause this instance
   * @example
   * await instance.unpause();
   */
  async unpause () {
    await this._fetch('/unpause', { method: 'POST' })
  }

  /**
   * Reboot this instance.
   * @example
   * await instance.reboot();
   */
  async reboot () {
    await this._fetch('/reboot', { method: 'POST' })
    await this.waitForTaskState('rebooting')
    await this.waitForTaskState('none')
  }

  /**
   * Restore instance from backup
   * @param {string} [password] - Password for encrypted backups
   * @example
   * await instance.restoreBackup();
   */
  async restoreBackup (password) {
    await this._fetch('/restoreBackup', {
      method: 'POST',
      json: { password }
    })
    await this.waitForUserTask(null)
  }

  /**
   * @typedef {object} UpgradeOptions
   * @property {string} os - The target iOS version
   * @property {string} osbuild - Specific build identifier (optional)
   */

  /**
   * Upgrade the iOS version of this instance.
   * @param {UpgradeOptions} options
   * @example
   * await instance.upgrade({
   *     os: '16.1',
   *     osbuild: '20B79'
   * });
   */
  async upgrade (options) {
    await this._fetch('/upgrade', {
      method: 'POST',
      json: Object.assign({}, options)
    })
    await this.waitForState('updating')
  }

  /**
   * Destroy this instance.
   * @example <caption>delete all instances of the project</caption>
   * let instances = await project.instances();
   * instances.forEach(instance => {
   *     instance.destroy();
   * });
   */
  async destroy () {
    await this._fetch('', { method: 'DELETE' })
  }

  /**
   * Send a message to an jailbroken iOS device
   * @example
   * await instance.message('123','321');
   *
   * @param {string} number - phone number to receive the message from
   * @param {string} message - message to receive
   */
  async message (sender, message) {
    await this._fetch('/message', {
      method: 'POST',
      json: { number: sender, message: message }
    })
  }

  /**
   * Send a raw message to an jailbroken iOS device
   * @example
   * await instance.messageRaw('AAAAAAAAAAAAAAAAA');
   *
   * @param {string} data - hex encoded data to send
   */
  async messageRaw (data) {
    await this._fetch('/message', { method: 'POST', json: { raw: data } })
  }

  /**
   * Get CoreTrace Thread List
   * @return {Promise<ThreadInfo[]>}
   * @example
   * let procList = await instance.getCoreTraceThreadList();
   * for (let p of procList) {
   *     console.log(p.pid, p.kernelId, p.name);
   *     for (let t of p.threads) {
   *         console.log(t.tid, t.kernelId);
   *     }
   * }
   */
  async getCoreTraceThreadList () {
    return await this._fetch('/strace/thread-list', { method: 'GET' })
  }

  /**
   * Add List of PIDs/Names/TIDs to CoreTrace filter
   * @param {integer[]} pids - array of process IDs to filter
   * @param {string[]} names - array of process names to filter
   * @param {integer[]} tids - array of thread IDs to filter
   * @example
   * await instance.setCoreTraceFilter([111, 222], ["proc_name"], [333]);
   */
  async setCoreTraceFilter (pids, names, tids) {
    let filter = []
    if (pids.length) {
      filter = filter.concat(
        pids.map(pid => {
          return { trait: 'pid', value: pid.toString() }
        })
      )
    }
    if (names.length) {
      filter = filter.concat(
        names.map(name => {
          return { trait: 'name', value: name }
        })
      )
    }
    if (tids.length) {
      filter = filter.concat(
        tids.map(tid => {
          return { trait: 'tid', value: tid.toString() }
        })
      )
    }
    await this._fetch('', { method: 'PATCH', json: { straceFilter: filter } })
  }

  /**
   * Clear CoreTrace filter
   * @example
   * await instance.clearCoreTraceFilter();
   */
  async clearCoreTraceFilter () {
    await this._fetch('', { method: 'PATCH', json: { straceFilter: [] } })
  }

  /**
   * Start CoreTrace
   * @example
   * await instance.startCoreTrace();
   */
  async startCoreTrace () {
    await this._fetch('/strace/enable', { method: 'POST' })
    if (this.info.coreTrace) {
      await this._waitFor(() => this.info.coreTrace.enabled === true)
    }
  }

  /**
   * Stop CoreTrace
   * @example
   * await instance.stopCoreTrace();
   */
  async stopCoreTrace () {
    await this._fetch('/strace/disable', { method: 'POST' })
    if (this.info.coreTrace) {
      await this._waitFor(() => this.info.coreTrace.enabled === false)
    }
  }

  /**
   * Download CoreTrace Log
   * @example
   * let trace = await instance.downloadCoreTraceLog();
   * console.log(trace.toString());
   */
  async downloadCoreTraceLog () {
    const token = await this._fetch('/strace-authorize', { method: 'GET' })
    const response = await fetchApi(this.project, '/preauthed/' + token.token + '/coretrace.log', {
      response: 'raw'
    })
    return await response.buffer()
  }

  /**
   * Clean CoreTrace log
   * @example
   * await instance.clearCoreTraceLog();
   */
  async clearCoreTraceLog () {
    await this._fetch('/strace', { method: 'DELETE' })
  }

  /**
   * Returns a bidirectional node stream for this instance's frida console.
   * @return {WebSocket-Stream}
   * @example
   * const consoleStream = await instance.fridaConsole();
   * consoleStream.pipe(process.stdout);
   */
  async fridaConsole () {
    const { url } = await this._fetch('/console?type=frida')
    const fridaConsole = wsstream(url, ['binary'])

    await new Promise(resolve => {
      fridaConsole.socket.on('open', () => {
        resolve()
      })
    })

    return fridaConsole
  }

  /**
   * Execute FRIDA script by name
   * @param {string} filePath - path to FRIDA script
   * @example
   * await instance.executeFridaScript("/data/corellium/frida/scripts/script.js");
   */
  async executeFridaScript (filePath) {
    const fridaConsoleStream = await this.fridaConsole()
    fridaConsoleStream.socket.on('close', function () {
      fridaConsoleStream.destroy()
    })

    fridaConsoleStream.socket.send('%load ' + filePath + '\n', null, () =>
      fridaConsoleStream.socket.close()
    )

    fridaConsoleStream.socket.close()
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
  async takeScreenshot (options) {
    const { format = 'png', scale = 1 } = options || {}
    const res = await this._fetch(`/screenshot.${format}?scale=${scale}`, {
      response: 'raw'
    })
    if (res.buffer) return await res.buffer()
    // node
    else return await res.blob() // browser
  }

  /**
   * Enable exposing a port for connecting to VM.
   * For iOS, this would mean ssh, for Android, adb access.
   */
  async enableExposedPort () {
    await this._fetch('/exposeport/enable', { method: 'POST' })
  }

  /**
   * Disable exposing a port for connecting to VM.
   * For iOS, this would mean ssh, for Android, adb access.
   */
  async disableExposedPort () {
    await this._fetch('/exposeport/disable', { method: 'POST' })
  }

  async update () {
    this.receiveUpdate(await this._fetch(''))
  }

  receiveUpdate (info) {
    this.infoDate = new Date()
    // one way of checking object equality
    if (JSON.stringify(info) !== JSON.stringify(this.info)) {
      this.info = info
      /**
       * Fired when a property of an instance changes, such as its name or its state.
       * @event Instance#change
       * @example
       * instance.on('change', () => {
       *     console.log(instance.id, instance.name, instance.state);
       * });
       */
      this.emit('change')
      if (info.panicked) {
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
        this.emit('panic')
      }
    }
  }

  /**
   * Wait for ...
   * @param {function} reporterFn - Called with instance information (optional)
   */
  async _waitFor (callback, reporterFn = null) {
    await this.update()
    return new Promise(resolve => {
      const change = () => {
        let done
        try {
          done = callback()
        } catch (e) {
          done = false
        }
        if (typeof reporterFn === 'function') {
          reporterFn(this.info)
        }
        if (done) {
          this.removeListener('change', change)
          resolve()
        }
      }

      this.on('change', change)
      change()
    })
  }

  /**
   * Wait for the instance to finish upgrading.
   * @param {function} reporterFn - Called with instance information (optional)
   * @example <caption>Wait for VM to finish OS upgrade</caption>
   * instance.finishUpgrade();
   */
  async finishUpgrade (reporterFn = null) {
    await this._waitFor(() => this.state !== 'updating', reporterFn)
  }

  /**
   * Wait for the instance to finish restoring and start its first boot.
   * @param {function} reporterFn - Called with instance information (optional)
   * @example <caption>Wait for VM to finish restore</caption>
   * instance.finishRestore();
   */
  async finishRestore (reporterFn = null) {
    await this._waitFor(() => this.state !== 'creating', reporterFn)
  }

  /**
   * Wait for the instance to enter the given state.
   * @param {string} state - state to wait
   * @param {function} reporterFn - Called with instance information (optional)
   * @example <caption>Wait for VM to be ON</caption>
   * instance.waitForState('on');
   */
  async waitForState (state, reporterFn = null) {
    await this._waitFor(() => this.state === state, reporterFn)
  }

  /**
   * Wait for the instance task to enter the given state.
   * @param {function} reporterFn - Called with instance information (optional)
   * @param {string} taskName
   */
  async waitForTaskState (taskName, reporterFn = null) {
    await this._waitFor(() => this.taskState === taskName, reporterFn)
  }

  /**
   * Wait for the instance user task name to be a given state.
   * @param {function} reporterFn - Called with instance information (optional)
   * @param {string} userTaskName
   */
  async waitForUserTask (userTaskName, reporterFn = null) {
    await this._waitFor(() => {
      if (!userTaskName) {
        return !this.userTask
      } else {
        return this.userTask.name === userTaskName
      }
    }, reporterFn)
  }

  async _fetch (endpoint = '', options = {}) {
    return await fetchApi(this.project, `/instances/${this.id}${endpoint}`, options)
  }

  /**
   * Delete Iot Firmware that is attached to an instance
   * @param {FirmwareImage} firmwareImage
   */
  async deleteIotFirmware (firmwareImage) {
    return await this.deleteImage(firmwareImage)
  }

  /**
   * Delete kernel that is attached to an instance
   * @param {KernelImage} kernelImage
   */
  async deleteKernel (kernelImage) {
    return await this.deleteImage(kernelImage)
  }

  /**
   * Delete an image that is attached to an instance
   * @param {Image | KernelImage | FirmwareImage} kernelImage
   */
  async deleteImage (image) {
    return await fetchApi(this, `/images/${image.id}`, {
      method: 'DELETE'
    })
  }

  /**
   * Get all images attached to this instance with optional type
   * @param {string} type - the type of image being uploaded ie. kernel, ramdisk, devicetree, or backup
   */
  async getImages (type) {
    const images = (await Images.listImagesMetaData(this.project)).filter(
      i => i.instance === this.id
    )

    return type ? images.filter(i => i.type === type) : images
  }

  /**
   * Upload a partition (e.g. flash) to an instance.
   *
   * @param {string} filePath - The path on the local file system to get the firmware file.
   * @param {string} name - The name of the partition to load this file to.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<PartitionImage>}
   */
  async uploadPartition (filePath, name, progress) {
    return await this.compressAndUploadImage('partition', filePath, name, progress)
  }

  /**
   * Add a custom IoT firmware image to a project for use in creating new instances.
   *
   * @param {string} filePath - The path on the local file system to get the firmware file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<FirmwareImage>}
   */
  async uploadIotFirmware (filePath, name, progress) {
    return await this.uploadKernel(filePath, name, progress)
  }

  /**
   * compress an image and upload it to an instance
   *
   * @param {string} type - the type of image being uploaded ie. kernel, ramdisk, or devicetree
   * @param {string} filePath - The path on the local file system to get the file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<Image>}
   */
  async compressAndUploadImage (type, filePath, name, progress) {
    let tmpfile = null
    const data = await util.promisify(fs.readFile)(filePath)

    tmpfile = await compress(data, name)

    const uploadedImage = await this.uploadImage(type, tmpfile, name, progress)

    if (tmpfile) {
      fs.unlinkSync(tmpfile)
    }

    return { id: uploadedImage.id, name: uploadedImage.name }
  }

  /**
   * Add a kernel image to an instance
   *
   * @param {string} filePath - The path on the local file system to get the kernel file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<KernelImage>}
   */
  async uploadKernel (filePath, name, progress) {
    await this.compressAndUploadImage('kernel', filePath, name, progress)
  }

  /**
   * Add a ram disk image to an instance
   *
   * @param {string} filePath - The path on the local file system to get the ram disk file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<RamDiskImage>}
   */
  async uploadRamDisk (filePath, name, progress) {
    await this.compressAndUploadImage('ramdisk', filePath, name, progress)
  }

  /**
   * Add a device tree image to an instance.
   *
   * @param {string} filePath - The path on the local file system to get the device tree file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<DeviceTreeImage>}
   */
  async uploadDeviceTree (filePath, name, progress) {
    await this.compressAndUploadImage('devicetree', filePath, name, progress)
  }

  /**
   * Add an image to the instance. These images may be removed at any time and are meant to facilitate creating a new Instance with images.
   *
   * @param {string} type - E.g. fw for the main firmware image.
   * @param {string} filePath - The path on the local file system to get the file.
   * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
   * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
   *
   * @returns {Promise<Image>}
   */
  async uploadImage (type, filePath, name, progress) {
    const token = await this.project.getToken()
    const url =
      this.project.api +
      '/instances/' +
      encodeURIComponent(this.id) +
      '/image-upload/' +
      encodeURIComponent(type) +
      '/' +
      encodeURIComponent(uuidv4()) +
      '/' +
      encodeURIComponent(name)

    return await uploadFile(token, url, filePath, progress)
  }

  /**
   * Return a {@link WebPlayer} session tied to this instance.
   * Calling this method multiple times will reuse the same webplayer.
   *
   * @param {object} features - The enabled frontend feature set for this session
   * @param {object} permissions - The endpoint permissions for this session
   * @param {number?} expiresIn - Number of seconds until the token expires (default: 15 minutes)
   * @returns {Promise<WebPlayer | null>}
   *
   * @example
   * let webplayer = instance.webplayer(features, permissions);
   */
  async webplayer (features, permissions, expiresIn = 15 * 60) {
    if (this._webplayer === null) {
      this._webplayer = new WebPlayer(this.project, this.id, features, permissions)
      await this._webplayer._createSession(expiresIn, () => {
        console.log('Instance destroy WebPlayer')
        this._webplayer = null
      })
    }
    return this._webplayer
  }
}

module.exports = Instance
