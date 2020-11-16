const Corellium = require('../src/corellium').Corellium;
const {Input} = require('../src/input')
const config = require('./config.json');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const { resolve } = require('path');
const { resolveTxt } = require('dns');

/** @typedef {import('../src/project.js')} Project */
/** @typedef {import('../src/instance.js')} Instance */

describe('Corellium API', function () {
    this.slow(10000);
    this.timeout(20000);

    const INSTANCE_VERSIONS = [
        '7.1.2',
        '8.1.0',
        '9.0.0',
        '10.0.0',
        '11.0.0',
    ];

    const instanceMap = new Map();

    let project = /** @type {Project} */(null);

    before(async function () {
        if (config.endpoint === undefined ||
            config.username === undefined ||
            config.password === undefined ||
            config.project === undefined ||
            config.testFlavor === undefined) {
                new Error(`Bad configuration for testing provided, requires endpoint,` +
                `username, password, project and testFlavor defined to work`);
            }
    })

    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        after(async function () {
            this.timeout(20000 * 4);
            const instance = instanceMap.get(instanceVersion);
            if (instance !== undefined) {
                await instance.destroy();
                await instance.waitForState('deleting');
            }
        });
    });

    const corellium = new Corellium(config);
    let loggedIn;
    it('logs in successfully', async function () {
        await corellium.login();

        const token = await corellium.token;
        assert(token, 'Token was never set, login must have silently failed');
        assert(token.token, 'Token was never set, login must have silently failed');
        loggedIn = true;
    });

    describe('projects', function () {
        before(function () {
            assert(loggedIn, "All tests will fail as login failed");
        });

        it('lists projects', async function () {
            project = await corellium.projects().then((projects) => {
                let foundProject = projects.find(project => project.info.name === config.project)
                assert(foundProject !== undefined);
                if (foundProject === undefined)
                    new Error(`Your test config specifies a project named "${config.project}", ` +
                            `but no such project was found on ${config.endpoint}`);
                return foundProject;
            }).catch((error) => {
                throw error;
            });
        });

        it(`has room for ${INSTANCE_VERSIONS.length} new VMs (get quota / quotasUsed)`, async function () {
            assert(project, 'Unable to test as no project was returned from previous tests');
            assert(project.quotas !== project.quotasUsed);
            if (project.quotas - project.quotasUsed < 2 * INSTANCE_VERSIONS.length)
                throw new Error(`no room for an extra device to be made, please free at least ${2 * INSTANCE_VERSIONS.length} cores`);
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it('can start create', async function () {
                assert(project, 'Unable to test as no project was returned from previous tests');
                const name = `API Test ${instanceVersion}`;
                const instance = await project.createInstance({
                    flavor: config.testFlavor,
                    name: name,
                    os: instanceVersion,
                });

                instanceMap.set(instanceVersion, instance);

                await instance.waitForState('creating');
                assert.strictEqual(instance.flavor, config.testFlavor);
                assert.strictEqual(instance.name, name);
            })
        });

        it('can list supported devices', async function () {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === config.testFlavor);
            assert(firmware);
        });

        it('can get teams and users', async function () {
            let teamsAndUsers = await corellium.getTeamsAndUsers();
            teamsAndUsers.users.forEach((value, key) => {
                assert.strictEqual(value, corellium._users.get(key))
            });

            teamsAndUsers.teams.forEach((value, key) => {
                assert.strictEqual(value, corellium._teams.get(key))
            });
        });

        it('can get roles', async function () {
            const roles = await corellium.roles();
            assert(roles, 'Roles should not be undefined, even if there have been no roles');
        });

        // Not visible to cloud users with one project:
        it('can add and remove keys', async function () {
            let keyInfo = await project.addKey(
                'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCqpvRmc/JQoH9P6XVlHnod0wRCg+7iSGfpyoBoe+nWwp2iEqPyM7A2RzW7ZIX2FZmlD5ldR6Oj5Z+LUR/GXfCFQvpQkidL5htzGMoI59SwntpSMvHlFLOcbyS7VmI4MKbdIF+UrelPCcCJjOaZIFOJfNtuLWDx0L14jW/4wflzcj6Fd1rBTVh2SB3mvhsraOuv9an74zr/PMSHtpFnt5m4SYWpE4HLTf0FJksEe/Qda9jQu5i86Mhu6ewSAVccUDLzgz6E4i8hvSqfctcYGT7asqxsubPTpTPfuOkc3WOxlqZYnnAbpGh8NvCu9uC+5gfWRcLoyRBE4J2Y3wcfOueP example-key'
            ).then((projectKey) => {
                assert(projectKey.label === 'example-key', 'label defaults to public key comment');
                assert(projectKey.fingerprint === '9c:71:e5:40:08:fb:cd:88:1b:6d:8e:4f:c0:4c:0f:dd');
                return projectKey;
            }).catch((error) => {
                throw error;
            });

            const keys = await project.keys();
            assert(!!keys.find(key => key.identifier === keyInfo.identifier));

            await project.deleteKey(keyInfo.identifier).then((done) => {

            }).catch((error) => {
                throw error;
            });
        });

        it('can refresh', async function () {
            let tempName = project.info.name;
            await project.refresh();
            assert(tempName === project.info.name);
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it('can getInstance', async function () {
                const instanceFromMap = instanceMap.get(instanceVersion);
                const instance = await project.getInstance(instanceFromMap.id);
                assert(instance.id === instanceFromMap.id);
            });
        });

        it('can get openvpn profile', async function () {
            let expected = Buffer.from('client');

            await project.vpnConfig('ovpn', undefined)
            .then((profile) => {
                assert(profile.length > expected.length);
                assert(profile.compare(expected, 0, expected.length, 0, expected.length) === 0);
                return profile;
            }).catch((error) => {
                // Hack to ignore onsite installs for this test
                if (!error.toString().includes('500 Internal Server Error')) {
                    throw error;
                }
                console.log("Forcing pass, this does not appear to be a server which supports vpns");
                return undefined;
            });
        });

        it('can get tunnelblick profile', async function () {
            let expected = Buffer.from("504b0304", "hex");

            await project.vpnConfig('tblk', undefined)
            .then((profile) => {
                assert(profile.length > expected.length);
                assert(profile.compare(expected, 0, expected.length, 0, expected.length) === 0);
                return profile;
            }).catch((error) => {
                // Hack to ignore onsite installs for this test
                if (!error.toString().includes('500 Internal Server Error')) {
                    throw error;
                }
                console.log("Forcing pass, this does not appear to be a server which supports vpns");
                return undefined;
            });
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it('can finish create', async function () {
                this.slow(40000);
                this.timeout(70000);

                const instance = instanceMap.get(instanceVersion);
                await instance.finishRestore();
            });
        });
    });


    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        describe(`panics ${instanceVersion}`, function () {
            before(function () {
                assert(instanceMap.get(instanceVersion), 'No instances available for testing, tests will fail');
            });

            it('can request panics', async function () {
                const instance = instanceMap.get(instanceVersion);
                const panics = instance.panics();
                assert(panics, 'Panics should not be undefined, even if there have been no panics');
            });

            it('can clear panics', async function () {
                const instance = instanceMap.get(instanceVersion);
                instance.clearPanics();
            });
        });
    });

    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        describe(`instances ${instanceVersion}`, function () {
            before(function () {
                assert(instanceMap.get(instanceVersion), 'No instances available for testing, tests will fail');
            });

            before(async function () {
                const instance = instanceMap.get(instanceVersion);
                await instance.waitForState('on');
            });

            it('can take a screenshot', async function () {
                const expected = Buffer.from('89504E470D0A1A0A', 'hex');
                const instance = instanceMap.get(instanceVersion);
                await instance.takeScreenshot()
                    .then((png) => {
                        assert(png.length > expected.length);
                        assert(png.compare(expected, 0, expected.length, 0, expected.length) === 0);
                    });
            })

            it('can rename', async function () {
                const instance = instanceMap.get(instanceVersion);
                const instanceName = instance.name;
                async function rename(name) {
                    await instance.rename(name);
                    await instance.update();
                    assert.strictEqual(instance.name, name);
                }
                await rename('test rename foo');
                await rename(instanceName);
            });

            it('has a console log', async function () {
                const instance = instanceMap.get(instanceVersion);
                const log = await instance.consoleLog();
                if (log === undefined) {
                    throw new Error('Unable to acquire any console log');
                }
            })

            it('has a console', async function () {
                const instance = instanceMap.get(instanceVersion);
                const consoleStream = await instance.console();
                // Wait for the socket to open before killing it,
                // otherwise this will throw an error
                consoleStream.socket.on('open', function (err) {
                    consoleStream.socket.close();
                });
                // When the socket closes, it will be safe to destroy the console duplexify object
                consoleStream.socket.on('close', function () {
                    consoleStream.destroy();
                });
            });

            it('can send input', async function () {
                const input = new Input();
                const instance = instanceMap.get(instanceVersion);
                instance.sendInput(input.pressRelease('home'));
            });

            describe(`agent ${instanceVersion}`, function () {
                let agent;

                before(async function () {
                    this.timeout(100000);

                    const instance = instanceMap.get(instanceVersion);
                    await instance.waitForState('on');
                    await instance.waitForAgentReady();
                });

                beforeEach(async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (agent === undefined || !agent.connected) {
                        agent = await instance.newAgent();
                        await agent.ready();
                    }
                });

                after(async function () {
                    if (agent !== undefined && agent.connected)
                        agent.disconnect();
                });

                it('can list device apps', async function () {
                    let appList = await agent.appList();
                    assert(appList !== undefined && appList.length > 0);
                });

                describe(`Files ${instanceVersion}`, async function () {
                    let expectedData = Buffer.from('D1FF', 'hex');
                    let testPath;
                    it('can get temp file', async function () {
                        testPath = await agent.tempFile();
                    });

                    it('can upload a file', async function () {
                        let rs = stream.Readable.from(expectedData);

                        let lastStatus;
                        try {
                            await agent.upload(testPath, rs, (_progress, status) => {
                                lastStatus = status;
                            });
                        } catch (err) {
                            assert(false, `Error uploading file during '${lastStatus} stage: ${err}`);
                        }
                    });

                    it('can stat a file', async function () {
                        let stat = await agent.stat(testPath);
                        assert.strictEqual(stat.name, testPath);
                    });

                    it('can change a files attributes', async function () {
                        await agent.changeFileAttributes(testPath, {mode: 511});
                        let stat = await agent.stat(testPath);
                        assert.strictEqual(stat.mode, 33279);
                    });

                    it('can download files', async function () {
                        try {
                            let downloaded = await new Promise(resolve => {
                                const rs = agent.download(testPath)
                                let bufs = [];
                                rs.on('data', function (chunk) {
                                    bufs.push(chunk);
                                });
                                rs.on('end', function () {
                                    resolve(Buffer.concat(bufs));
                                });
                            });

                            assert(Buffer.compare(downloaded, expectedData) === 0);
                        } catch (err) {
                            assert(false, `Error reading downloadable file ${err}`);
                        }
                    });

                    it('can delete files', async function () {
                        await agent.deleteFile(testPath)
                        .then((path) => {
                            assert(path === undefined);
                        })

                        // We should get an OperationFailed since the file is gone
                        try {
                            await agent.stat(testPath)
                        } catch (error) {
                            assert(error.toString().includes('No such file or directory'));
                        }
                    });
                });

                describe(`profiles ${instanceVersion}`, async function () {
                    if(config.testFlavor === 'ranchu') {
                        // These are unimplemented on ranchu devices
                        it('cannot use profile/list', async function () {
                            assert.rejects(() => agent.profileList());
                        });

                        it('cannot use profile/install', async function () {
                            assert.rejects(() => agent.installProfile('test'));
                        });

                        it('cannot use profile/remove', async function () {
                            assert.rejects(() => agent.removeProfile('test'));
                        });

                        it('cannot use profile/get', async function () {
                            assert.rejects(() => agent.getProfile('test'));
                        });
                    }
                });

                describe(`locks ${instanceVersion}`, async function () {
                    if(config.testFlavor === 'ranchu') {
                        // These are unimplemented on ranchu devices
                        it('cannot use lock', async function () {
                            assert.rejects(() => agent.lockDevice());
                        });

                        it('cannot use unlock', async function () {
                            assert.rejects(() => agent.unlockDevice());
                        });

                        it('cannot use acquireDisableAutolockAssertion', async function () {
                            assert.rejects(() => agent.acquireDisableAutolockAssertion());
                        });

                        it('cannot use releaseDisableAutolockAssertion', async function () {
                            assert.rejects(() => agent.releaseDisableAutolockAssertion());
                        });
                    }
                });

                describe(`WiFi ${instanceVersion}`, async function () {
                    if(config.testFlavor === 'ranchu') {
                        // These are unimplemented on ranchu devices
                        it('cannot use connectToWifi', async function () {
                            assert.rejects(() => agent.connectToWifi());
                        });

                        it('cannot use disconnectFromWifi', async function () {
                            assert.rejects(() => agent.disconnectFromWifi());
                        });
                    }
                });

                let installSuccess;
                describe(`Applications ${instanceVersion}`, async function () {
                    const instance = instanceMap.get(instanceVersion);

                    it('can install a signed apk', async function () {
                        this.slow(50000);
                        this.timeout(100000);
                        let retries = 3;

                        while (true) {
                            let lastStatus;
                            let rs = fs.createReadStream(path.join(__dirname, 'api-test.apk'));
                            try {
                                await agent.installFile(rs, (_progress, status) => {
                                    lastStatus = status;
                                });
                                installSuccess = true;
                            } catch (err) {
                                if (err.toString().includes('Agent did not get a response to pong in 10 seconds, disconnecting.')) {
                                    --retries;
                                    if (retries !== 0) {
                                        agent.disconnect();
                                        agent = await instance.newAgent();
                                        await agent.ready();
                                        continue;
                                    }
                                }

                                assert(false, `Error installing app during '${lastStatus} stage: ${err}`);
                                installSuccess = false;
                            } finally {
                                rs.close();
                            }

                            break;
                        }
                    });

                    it('can run an app', async function () {
                        assert(installSuccess, "This test cannot run because application installation failed");
                        await agent.run('com.corellium.test.app');
                    });

                    it('can kill an app', async function () {
                        assert(installSuccess, "This test cannot run because application installation failed");
                        await agent.kill('com.corellium.test.app');
                    });
                });

                describe(`crash watcher ${instanceVersion}`, async function () {

                    let crashListener;
                    before(async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.waitForState('on');
                        await instance.waitForAgentReady();
                        crashListener = await instance.newAgent();
                    });

                    after(async function () {
                        if (crashListener !== undefined && crashListener.connected)
                            crashListener.disconnect();
                    });

                    it('can catch an expected crash', function () {
                        return new Promise(async (resolve) => {
                            assert(installSuccess, "This test cannot run because application installation failed");
                            await crashListener.ready();
                            crashListener.crashes('com.corellium.test.app', (err, crashReport) => {
                                assert(!err, err);
                                assert(crashReport !== undefined, 'The crash report is undefined');
                                assert(crashReport.includes('com.corellium.test.app'), `The crash reported doesn't include "com.corellium.test.app":\n\n${crashReport}`);
                                resolve();
                            }).catch((error) => {
                                if (error.message && error.message.includes('disconnected')) {
                                    return;
                                }
                                throw error;
                            });
                            await agent.runActivity('com.corellium.test.app', 'com.corellium.test.app/com.corellium.test.app.CrashActivity');
                        });
                    });
                });

                describe(`Network Monitor ${instanceVersion}`, function () {
                    let netmon;

                    it('can get monitor', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        netmon = await instance.newNetworkMonitor();
                    });

                    let netmonOutput = [];
                    it('can start monitor', async function () {
                        this.slow(15000);

                        const instance = instanceMap.get(instanceVersion);
                        return new Promise(async (resolve) => {
                            netmon.handleMessage((message) => {
                                let host = message.request.headers.find(entry => entry.key === 'Host');
                                netmonOutput.push(host.value);
                            });
                            await netmon.start();
                            resolve();
                        });
                    });

                    it('can monitor data', async function () {
                        assert(installSuccess, "This test cannot run because application installation failed");
                        this.slow(15000);

                        await agent.runActivity('com.corellium.test.app', 'com.corellium.test.app/com.corellium.test.app.NetworkActivity');
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        assert(netmonOutput.find(host => host === 'corellium.com') === 'corellium.com');
                    });

                    it('can stop monitor', async function () {
                        const instance = instanceMap.get(instanceVersion);

                        await netmon.stop();
                    });

                    it('can clear log', async function () {
                        const instance = instanceMap.get(instanceVersion);

                        await netmon.clearLog();
                    });
                });

                describe(`Frida ${instanceVersion}`, function () {
                    let pid = 0;
                    let name = '';

                    it('can get process list', async function () {
                        let procList = await agent.runFridaPs();
                        let lines = procList.output.trim().split('\n');
                        lines.shift();
                        lines.shift();
                        for (const line of lines) {
                            [pid, name] = line.trim().split(/\s+/);
                            if (name == 'keystore') {
                                break;
                            }
                        }
                        assert(pid != 0);
                    });

                    it('can get console', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        const consoleStream = await instance.fridaConsole();
                        // Wait for the socket to open before killing it,
                        // otherwise this will throw an error
                        consoleStream.socket.on('open', function (err) {
                            consoleStream.socket.close();
                        });
                        // When the socket closes, it will be safe to destroy the console duplexify object
                        consoleStream.socket.on('close', function () {
                            consoleStream.destroy();
                        });
                    });

                    describe('frida attaching and execution', async function () {
            
                        it('can attach frida', async function () {
                            if (name === '') {
                                name = 'keystore';
                            }
                            await agent.runFrida(pid, name);
                            while (true) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                                let procList = await agent.runFridaPs();
                                if(procList.attached !== undefined && procList.attached.target_name == name)
                                    break;
                            }
                        });

                        it('can get frida scripts', async function () {
                            let fridaScripts = await agent.stat('/data/corellium/frida/scripts/');
                            let scriptList = fridaScripts.entries.map(entry => entry.name);
                            let s = '';
                            for(s of scriptList) {
                                if (s == 'hook_native.js')
                                    break;
                            }
                            assert(s != '');
                        });

                        it('can execute script', async function () {
                            const instance = instanceMap.get(instanceVersion);
                            await instance.executeFridaScript('/data/corellium/frida/scripts/hook_native.js');
                            await new Promise(resolve => setTimeout(resolve, 5000));

                            let fridaConsole = await instance.fridaConsole();
                            fridaConsole.socket.on('close', function () {
                                fridaConsole.destroy();
                            });
                            let fridaOutput = await new Promise(resolve => {
                                const w = new stream.Writable({
                                    write(chunk, encoding, callback) {
                                        fridaConsole.socket.close();
                                        resolve(chunk);
                                    }
                                });
                                fridaConsole.pipe(w);
                            });
                            assert(fridaOutput.toString().includes('Hook android_log_write()'));
                        });

                        it('can detach frida', async function () {
                            await agent.runFridaKill();
                        });
                    });
                });

                describe(`app clean up ${instanceVersion}`, function () {
                    it('can uninstall an app', async function () {
                        assert(installSuccess, "This test cannot run because application installation failed");

                        let lastStatus;
                        try {
                            await agent.uninstall('com.corellium.test.app', (_progress, status) => {
                                lastStatus = status;
                            });
                        } catch (err) {
                            assert(false, `Error uninstalling app during '${lastStatus} stage: ${err}`);
                        }
                    });
                });

                describe(`CoreTrace ${instanceVersion}`, function () {
                    let pid = 0;

                    it('can get thread list', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        let threadList = await instance.getCoreTraceThreadList();
                        for (let p of threadList) {
                            if (p.name.includes("corelliumd")) {
                                pid = p.pid;
                                break;
                            }
                        }
                        assert(pid != 0);
                    });

                    it('can set filter', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.setCoreTraceFilter([pid], [], []);
                    });

                    it('can start capture', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.startCoreTrace();
                    });

                    it('can capture data', async function () {
                        this.slow(15000);

                        const instance = instanceMap.get(instanceVersion);
                        // await instance.waitForAgentReady();
                        // agent = await instance.newAgent();
                        await agent.stat('/data/corellium/frida/scripts/');
                        // agent.disconnect();

                        await new Promise(resolve => setTimeout(resolve, 5000));

                        const log = await instance.downloadCoreTraceLog();
                        assert(log !== undefined);
                        assert(log.toString().includes(':corelliumd'));
                    });

                    it('can stop capture', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.stopCoreTrace();
                    });

                    it('can clear filter', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.clearCoreTraceFilter();
                    });

                    it('can clear log', async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.clearCoreTraceLog();
                    });
                });
            });

            async function turnOn() {
                const instance = instanceMap.get(instanceVersion);
                await instance.start();
                await instance.waitForState('on');
                assert.strictEqual(instance.state, 'on');
            }

            async function turnOff() {
                const instance = instanceMap.get(instanceVersion);
                await instance.stop();
                await instance.waitForState('off');
                assert.strictEqual(instance.state, 'off');
            }

            describe(`device lifecycle ${instanceVersion}`, function () {
                this.slow(20000);
                this.timeout(40000);

                beforeEach(async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await instance.update();
                });

                it('can pause', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await instance.waitForState('on');
                    await instance.pause();
                    await instance.waitForState('paused');
                });

                it('can unpause', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'paused') {
                        await instance.pause();
                        await instance.waitForState('paused');
                    }

                    await instance.unpause();
                    await instance.waitForState('on');
                });

                it('can reboot', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'on') {
                        await turnOn(instance);
                    }
                    await instance.reboot();
                });

                it('can stop', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'on') {
                        await turnOn(instance);
                    }
                    await turnOff(instance);
                });

                it('can start', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'off') {
                        await turnOff(instance);
                    }
                    await turnOn(instance);
                });
            });

            describe(`snapshots ${instanceVersion}`, function () {
                before(async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await instance.update();
                });

                it('has a fresh snapshot', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    const snapshots = await instance.snapshots();
                    const fresh = snapshots.find(snap => snap.fresh);
                    assert(fresh !== undefined);
                });

                it('refuses to take snapshot if instance is on', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'on') {
                        await turnOn(instance);
                    }
                    await assert.rejects(() => instance.takeSnapshot());
                });

                let latest_snapshot;
                it('can take snapshot if instance is off', async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'off') {
                        await turnOff(instance);
                    }

                    latest_snapshot = await instance.takeSnapshot();
                });

                it('can restore a snapshot', async function () {
                    assert(latest_snapshot, "This test cannot run because there is no latest_snapshot to utilize");
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'off') {
                        await turnOff(instance);
                    }

                    await latest_snapshot.restore();
                });

                it('can delete a snapshot', async function () {
                    assert(latest_snapshot, "This test cannot run because there is no latest_snapshot to utilize");
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== 'off') {
                        await turnOff(instance);
                    }

                    await latest_snapshot.delete();
                });
            });
        });
    });
});
