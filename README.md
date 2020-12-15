# Corellium API Documentation

```javascript=
const Corellium = require('corellium-api').Corellium;
```

## class Corellium

### new Corellium(options)

Sets up a new Corellium endpoint to use. Accepted options are:

- `options.endpoint`: the URL of the endpoint to use
- `options.username`: username to use for login
- `options.password`: password for given username

Example:
```javascript=
let corellium = new Corellium({
    endpoint: 'https://client.corellium.com',
    username: 'admin',
    password: 'password'
});
```

### async login()

Performs the login on the endpoint using the credentials passed through the constructor.

Example:
```javascript=
await corellium.login();
```

### async projects()

Returns all projects from the connected endpoint as an `Array`.

Example:
```javascript=
let projects = await corellium.projects();
let project = projects.find(project => project.name === "Demo Project");
```
Line 2 shows how to pick a specific project from the returned map.

### async getProject(projectId)

Returns the `Project` with the identifier `projectId` or *undefined* if it does not exist.

Example:
```javascript=
let project = await corellium.getProject('b5ef6be5-71a9-4a26-a320-9be182217ac8');
```

### async projectNamed(name)

Returns the `Project` with the name `name` or *undefined* if it does not exist.

Example:
```javascript=
let project = await corellium.projectNamed('Default Project');
```

### async supported()

Returns an `Array` with all devices that are supported by the endpoint, with their supported firmwares.

Example:
```javascript=
let supported = await corellium.supported();
```

## class Project

**Note:** Instances of the class `Project` are supposed to be created using the `Corellium#projects()`, `Corellium#getProject()`, or `Corellium#projectNamed()` methods.

### Property: name

Returns the name of the project.

Example:
```javascript=
let name = project.name;
```

### Property: quotas

Returns the quotas of the project. Currently, `quotas`' only element is `cpus`. 

Example:
```javascript=
// Create map of supported devices.
let supported = {};
(await corellium.supported()).forEach(modelInfo => {
    supported[modelInfo.name] = modelInfo;
});

// Get how many CPUs we're currently using.
let cpusUsed = 0;
instances.forEach(instance => {
    cpusUsed += supported[instance.flavor].quotas.cpus;
});

console.log('Used: ' + cpusUsed + '/' + project.quotas.cpus);
```

### async instances()

Returns an `Array` of `Instance` objects of all virtual machine instances.

Example:
```javascript=
let instances = await project.instances();
let instance = instances.find(instance => instance.name === 'Test-Device');
```
Line 2 shows how to select a specific instance by name from the returned instances.

### async getInstance(id)

Returns the instance identified by `id`.

Example:
```javascript=
let instance = project.getInstance('a9212122-40b0-1387-7feb-7a721916580d');
```

### async createInstance(options)

Creates a new instance with the given options. The following options are supported:
- `options.name`: The name of the new Instance.
- `options.flavor`: The flavor of the `Instance` that is being created. Currently, the following flavors are supported:
   - `ranchu` for Android devices
   - `iphone6`
   - `iphone6plus`
   - `iphone6s`
   - `iphone6splus`
   - `iphone7`
   - `iphone7plus`
   - `iphonese`
   - `iphone8`
   - `iphone8plus`
   - `iphonex`
   - `ipodtouch6`
   - `ipadmini4wifi`
- `options.os`: The software version, e.g. `11.3.1` for iOS, or `11.0.0` for Android
- `options.patches`: The following values are supported:
   - `jailbroken` The instance should be jailbroken (default).
   - `nonjailbroken` The instance should not be jailbroken.

Example:
```javascript=
// create instance
let instance = await project.createInstance({
    'name': 'Test Device',
    'flavor': 'ranchu',
    'os': '11.0.0'
});
// wait for the instance to finish restoring
await instance.finishRestore();
```

## class Instance

**Note:** instances of class `Instance` are only supposed to be retrieved by `Project#instances()`, `Project#getInstance()`, or `Project#createInstance`.

### Property: name

The name of the instance.

Example:
```javascript=
let instances = await project.instances();
let instance = instances[0];
console.log("Using " + instance.name);
```

### Property: state

Returns the state of the `Instance`.

Valid states are:
- `on`: The `Instance` is running.
- `off`: The `Instance` is not running.
- `creating`: The `Instance` is being created.
- `deleting`: The `Instance` is being deleted.

Example:
```javascript=
await instance.start();
await instance.waitForState('on');
assert.equal(instance.state, 'on');
```

See also: `Instance.waitForState()`

### Property: flavor

Returns the flavor of the `Instance`.

Example:
```javascript=
let instances = await project.instances();
instances.forEach(instance => {
    console.log(instance.name + ': ' + instance.flavor);
});
```

### async rename(name)

Renames an `Instance` to `name`.

Example:
```javascript=
let instances = await project.instances();
let instance = instances.find(instance => instance.name === 'Test-Device');
await instance.rename('Demo-Device');
```

### async snapshots()

Returns an `Array` of `Snapshot` objects with the snapshots for the current `Instance`.

Example:
```javascript=
let snapshots = instance.snapshots();
snapshots.forEach(snapshot => {
    console.log(snapshot.name, snapshot.created);
});
```

### async takeSnapshot(name)

Creates a snapshot named `name` of an `Instance`. Returns an instance of `Snapshot`.

Example:
```javascript=
await instance.takeSnapshot('before-test');
```

### async consoleLog()

Returns the current console log of an `Instance`.

Example:
```javascript=
console.log(await instance.consoleLog());
```

### async panics()

Returns recorded panics of an `Instance`.

Example:
```javascript=
console.log(await instance.panics());
```
See also: `Event: panic`

### async clearPanics()

Clears recorded panics of an `Instance`.

Example:
```javascript=
await instance.clearPanics();
```
See also: `Event: panic`

### async agent()

Returns an `Agent` instance for the `Instance`.

Example:
```javascript=
let agent = await instance.agent();
await agent.ready();
```

### async newAgent()

Creates an additional `Agent` connection to the `Instance`. This is required for agent tasks that do not actually finish, like `Agent#crashes()`.

Example:
```javascript=
let crashListener = await instance.newAgent();
crashListener.crashes('com.corellium.demoapp', (err, crashReport) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(crashReport);
});
```

### async console()

Returns a node stream for the `Instance`'s console.

Example:
```javascript=
let consoleStream = await instance.console();
consoleStream.pipe(process.stdout);
```

### async start()

Starts an `Instance`.

Example:
```javascript=
await instance.start();
```

### async stop()

Stops an `Instance`.

Example:
```javascript=
await instance.stop();
```

### async reboot()

Reboots an `Instance`.

Example:
```javascript=
await instance.reboot();
```

### async destroy()

Destroys an `Instance`.

Example:
```javascript=
// delete all instances of the project
let instances = await project.instances();
instances.forEach(instance => {
    instance.destroy();
});
```

### async getCoreTraceThreadList()

Returns array of threads in the following format:
```
[
	{ pid, kernelId, name, threads: [ { tid, kernelId }, ... ] },
	...
]
```

Example:
```javascript=
let procList = await instance.getCoreTraceThreadList();
for (let p of procList) {
	console.log(p.pid, p.kernelId, p.name);
	for (let t of p.threads) {
		console.log(t.tid, t.kernelId);
	}
}
```

### async setCoreTraceFilter(pids, names, tids)

Creates CoreTrace filter from array of PIDs, TIDs and process names.

Example:
```javascript=
await instance.setCoreTraceFilter([111, 222], ["proc_name"], [333]);
```

### async clearCoreTraceFilter()

Clears CoreTrace filter.

Example:
```javascript=
await instance.clearCoreTraceFilter();
```

### async startCoreTrace()

Starts CoreTrace capture.

Example:
```javascript=
await instance.startCoreTrace();
```

### async stopCoreTrace()

Stops CoreTrace capture.

Example:
```javascript=
await instance.stopCoreTrace();
```

### async downloadCoreTraceLog()

Returns captured CoreTrace data.

Example:
```javascript=
let trace = await instance.downloadCoreTraceLog();
console.log(trace.toString());
```

### async clearCoreTraceLog()

Clears captured CoreTrace data.

Example:
```javascript=
await instance.clearCoreTraceLog();
```

### async fridaConsole()

Returns a node stream for the `Instance`'s FRIDA console.

Example:
```javascript=
let consoleStream = await instance.fridaConsole();
consoleStream.pipe(process.stdout);
```

### async executeFridaScript(filePath)

Execute installed FRIDA script with path.

Example:
```javascript=
await instance.executeFridaScript("/data/corellium/frida/scripts/script.js");
```

### async takeScreenshot()

Instructions the `Instance` to create a screenshot of the device screen. Returns a `Buffer` with PNG data.

Example:
```javascript=
let screenshot = instance.takeScreenshot();
fs.writeFileSync('screenshot.png', screenshot);
```

### async finishRestore()

Waits for a device to finish restoring.

Example:
```javascript=
await instance.finishRestore();
```

See also the example at `Project#createInstance()`

### async waitForState(state)

Waits for the `Instance` to switch to a specific state. For valid states, see `Property: state`.

Example:
```javascript=
await instance.waitForState('on');
```

### Event: change

`Instance` emits a `change` event when its info changes, e.g. when the instance is renamed or its state changes.

Example:
```javascript=
instance.on('change', async () => {
    console.log(instance.id, instance.name, instance.state);
});
```

### Event: panic

`Instance` emits a `panic` event when a panic occurred.

Example:
```javascript=
instance.on('panic', async () => {
    console.log('Panic detected!');

    // get the panic log(s)
    console.log(await instance.panics());

    // Download the console log.
    console.log(await instance.consoleLog());

    // Clear the panic log.
    await instance.clearPanics();

    // Reboot the instance.
    await instance.reboot();
});
```

## class Agent

**Note:** Instances of the class `Agent` are only supposed to be retrieved with `Instance#agent()` or `Instance#newAgent()`.

### async ready()

Waits for the agent to be ready to use. This essentially means that it will wait until Springboard has launched.

Example:
```javascript=
let agent = await instance.agent();
await agent.ready();
```

### async appList()

Returns an `Array` of installed apps.

Example:
```javascript=
let appList = await agent.appList();
for (app of appList) {
    console.log('Found installed app ' + app['bundleID']);
}
```

### async run(bundleID)

Launches the app with the given `bundleID`.

Example:
```javascript=
await agent.run("com.corellium.demoapp");
```

### async kill(bundleID)

Kills the underlying process of the app identified by `bundleID`.

Example:
```javascript=
await agent.kill("com.corellium.demoapp");
```

### async install(path, [progress])

Installs an app, where the packaged app needs to be available on the VMs filesystem at `path`. The optional `progress` parameter expects a callback function with signature `(progress, status)`, where `progress` is the percentage as float, and `status` a string with the current status of the installation progress.

To upload a file to the VM's filesystem, see `Agent#upload()`.

See also `Agent#installFile()` which will handle the file upload on its own.

Example:
```javascript=
await agent.install('/var/tmp/temp.ipa', (progress, status) => {
    console.log(progress, status);
});
```

### async installFile(stream, [progress])

Uploads the packaged app provided through the node stream object `stream` and installs it on the VM. The optional `progress` parameter expects a callback function with signature `(progress, status)`, where `progress` is the percentage as float, and `status` a string with the current status of the installation progress.

Example:
```javascript=
await agent.installFile(fs.createReadStream('test.ipa'), (progress, status) => {
    console.log(progress, status);
});
```

### async uninstall(bundleID, [progress])

Uninstalls the app identified by `bundleID`. The optional `progress` parameter expects a callback function with signature `(progress, status)`, where `progress` is the percentage as float, and `status` a string with the current status of the uninstallation progress.

Example:
```javascript=
await agent.uninstall('com.corellium.demoapp', (progress, status) => {
    console.log(progress, status);
});
```

### async tempFile()

Returns a temporary random filename on the VMs filesystem that by the time of invocation of this method is guaranteed to be unique.

See example at `Agent#upload()`.

### async upload(path, stream)

Example:
```javascript=
let tmpName = await agent.tempFile();
await agent.upload(tmpName, fs.createReadStream('test.ipa'));
```

### download(path)

Downloads the file at `path` from the VM's filesystem. Returns a node stream object.

Example:
```javascript=
let dl = agent.download('/var/tmp/test.log');
dl.pipe(fs.createWriteStream('test.log'));
```

### async deleteFile(path)

Deletes the file at `path` on the VM's filesystem.

Example:
```javascript=
await agent.deleteFile('/var/tmp/test.log');
```

### crashes(bundleID, callback)

Subscribes to crash events for a given app identified by `bundleID`. The callback will be called as soon as the agent found a new crash log. The signature is `(err, crashReport)` where `err` is only defined if an error occured setting up or watching for crash logs and `crashReport` will contain the full crash report data.

Currently this is only available on iOS virtual devices.

**Note:** Since this method blocks the communication channel of the agent to wait for crash reports, a new `Agent` connection should be created with `Instance#newAgent()`.

Example:
```javascript=
let crashListener = await instance.newAgent();
crashListener.crashes("com.corellium.demoapp", (err, crashReport) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(crashReport);
});
```

### async lockDevice()

Locks the device software-wise.

Example:
```javascript=
await agent.lockDevice();
```

### async unlockDevice()

Unlocks the device software-wise.

Example:
```javascript=
await agent.unlockDevice();
```

### disconnect()

Disconnects an `Agent` connection. This is usually only required if a new agent connection has been created and is no longer needed, for example if the `crashListener` demonstrated in the example at `Agent#crashes()` is not required anymore.

Example:
```javascript=
// subscribe for crash logs
let crashListener = await instance.newAgent();
crashListener.crashes("com.corellium.demoapp", (err, crashReport) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(crashReport);
});

// wait 15 seconds
let timeoutComplete = null;
new Promise(resolve => {
    timeoutComplete = resolve;
    setTimeout(timeoutComplete, 15000);
});

// crashListener not required anymore
crashListener.disconnect();
```

### async runFridaPs()

Returns processes avialable for FRIDA to attach.

Example:
```javascript=
let procList = await agent.runFridaPs();
let lines = procList.output.trim().split('\n');
// Discard the first two lines.
lines.shift();
lines.shift();
for (const line of lines) {
    const [pid, name] = line.trim().split(/\s+/);
    console.log(pid, name);
}
```

### async runFrida(pid)

Attaches FRIDA to the process with PID.

Example:
```javascript=
await agent.runFrida(111);
```

### async runFridaKill()

Detaches FRIDA from current process.

Example:
```javascript=
await agent.runFridaKill();
```

## class NetworkMonitor

**Note:** Instances of the class `NetworkMonitor` are only supposed to be retrieved with `Instance#networkMonitor()` or `Instance#newNetworkMonitor()`.

### async handleMessage(handler)

Install handler for captured Network Monitor data

Example:
```javascript=
let netmon = await instance.newNetworkMonitor();
netmon.handleMessage((message) => {
    let host = message.request.headers.find(entry => entry.key === 'Host');
    console.log(message.response.status, message.request.method, message.response.body.size, host.value);
});
```

### async start()

Starts capturing Network Monitor data

Example:
```javascript=
let netmon = await instance.newNetworkMonitor();
netmon.start();
```

### async stop()

Stops capturing Network Monitor data

Example:
```javascript=
let netmon = await instance.newNetworkMonitor();
netmon.stop();
```

### async isEnabled()

Check if Network Monitor is enabled

Example:
```javascript=
let enabled = await netmon.isEnabled();
if (enabled) {
    console.log("enabled");
} else {
    console.log("disabled");
}
```

### async clearLog()

Clears captured Network Monitor data

Example:
```javascript=
let netmon = await instance.newNetworkMonitor();
netmon.clearLog();
```

## class Snapshot

**Note:** Instances of the class `Snapshot` are only supposed to be retrieved with `Instance#snapshots()` or `Instance#takeSnapshot()`.

### Property: name

Name of the snapshot.

### Property: created

The time the snapshot was created.

### Property: fresh

Tells wether a snapshot is fresh or not.

A snapshot will be automatically created after the initial restore of an `Instance` in which case it is considered fresh.

Example:
```javascript=
let snapshots = await instance.snapshots();
let freshSnapshot = snapshots.find(snapshot => snapshot.fresh);
await freshSnapshot.restore();
```

### async rename(name)

Renames a snapshot to `name`.

Example:
```javascript=
let snapshots = await instance.snapshots();
let snapshot = snapshots.find(snapshot => snapshot.name === 'Test 1');
if (snapshot) {
    await snapshot.rename('Test 1 new');
}
```

### async restore()

Restores a snapshot.

Example:
```javascript=
let snapshots = await instance.snapshots();
let snapshot = snapshots.find(snapshot => snapshot.name === 'Pre-Test 1');
if (snapshot) {
    await snapshot.restore();
}
```

### async delete()

Deletes a snapshot.

Example:
```javascript=
let snapshots = await instance.snapshots();
snapshots.forEach(snapshot => {
    console.log("Deleting snapshot " + snapshot.name)
    snapshot.delete();
});
```

