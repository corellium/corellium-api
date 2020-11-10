const Corellium = require('../src/corellium').Corellium;
const {Input} = require('../src/input')
const config = require('./config.json');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

/** @typedef {import('../src/project.js')} Project */
/** @typedef {import('../src/instance.js')} Instance */

describe('Corellium API', function() {
    this.slow(10000);
    this.timeout(20000);

    let project = /** @type {Project} */(null);
    let testInstance = /** @type {Instance} */(null);
    before(async function() {
        if (config.endpoint === undefined ||
            config.username === undefined ||
            config.password === undefined ||
            config.project === undefined ||
            config.testFlavor === undefined) {
                new Error(`Bad configuration for testing provided, requires endpoint,` +
                `username, password, project and testFlavor defined to work`);
            }
    })

    after(async function() {
        if (testInstance !== undefined) {
            await testInstance.destroy();
            await testInstance.waitForState('deleting');
        }
    });

    const corellium = new Corellium(config);
    it('logs in successfully', async function() {
        await corellium.login();
    });

    describe('projects', function() {
        it('lists projects', async function() {
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

        it('has room for one new vm (get quota / quotasUsed)', async function() {
            assert(project.quotas !== project.quotasUsed);
            if (project.quotas - project.quotasUsed < 2)
                throw new Error('no room for an extra device to be made, please free at least two cores');
        });

        it('can start create', async function() {
            const os = '11.0.0';
            const name = 'api test';
            testInstance = await project.createInstance({
                os: os,
                flavor: config.testFlavor,
                name: name,
            })
            .then((instance) => {
                return instance;
            }).catch((error) => {
                throw error;
            });

            await testInstance.waitForState('creating');
            assert.strictEqual(testInstance.name, name);
            assert.strictEqual(testInstance.flavor, config.testFlavor);
        })

        it('can list supported devices', async function() {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === config.testFlavor);
            assert(firmware);
        });

        it('can get teams and users', async function() {
            let teamsAndUsers = await corellium.getTeamsAndUsers();
            teamsAndUsers.users.forEach((value, key) => {
                assert.strictEqual(value, corellium._users.get(key))
            });

            teamsAndUsers.teams.forEach((value, key) => {
                assert.strictEqual(value, corellium._teams.get(key))
            });
        });

        it('can get roles', async function() {
            assert.doesNotReject(() => corellium.roles());
        });

        // Not visible to cloud users with one project:
        it('can add and remove keys', async function() {
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

        it('can refresh', async function() {
            let tempName = project.info.name;
            await project.refresh();
            assert(tempName === project.info.name);
        });

        it('can getInstance', async function() {
            let instance = await project.getInstance(testInstance.id);
            assert(instance.id === testInstance.id);
        });

        it('can get openvpn profile', async function() {
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

        it('can get tunnelblick profile', async function() {
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

        it('can finish create', async function() {
            this.timeout(70000);
            this.slow(40000);
            await testInstance.finishRestore();
        });
    });

    describe('panics', function() {
        it('can request panics', async function() {
            assert.doesNotReject(() => testInstance.panics());
        });

        it('can clear panics', async function() {
            assert.doesNotReject(() => testInstance.clearPanics());
        });
    });

    describe('instances', function() {
        before(async function() {
            if (testInstance === undefined)
                throw new Error('Previously created device does not seem to exist');
            await testInstance.waitForState('on');
        });

        it('can take a screenshot', async function() {
            let expected = Buffer.from('89504E470D0A1A0A', 'hex');
            await testInstance.takeScreenshot()
            .then((png) => {
                assert(png.length > expected.length);
                assert(png.compare(expected, 0, expected.length, 0, expected.length) === 0);
            });
        })

        it('can rename', async function() {
            async function rename(name) {
                await testInstance.rename(name);
                await testInstance.update();
                assert.strictEqual(testInstance.name, name);
            }
            await rename('test rename foo');
            await rename('api test');
        });

        it('has a console log', async function() {
            let log = await testInstance.consoleLog();
            if (log === undefined) {
                throw new Error('Unable to acquire any console log');
            }
        })

        it('has a console', async function() {
            const consoleStream = await testInstance.console();
            // Wait for the socket to open before killing it,
            // otherwise this will throw an error
            consoleStream.socket.on('open', function(err) {
                consoleStream.socket.close();
            });
            // When the socket closes, it will be safe to destroy the console duplexify object
            consoleStream.socket.on('close', function() {
                consoleStream.destroy();
            });
        });

        it('can send input', async function() {
            const input = new Input();
            assert.doesNotReject(() => testInstance.sendInput(input.pressRelease('home')));
        });

        describe('agent', function() {
            let agent;
            before(async function() {
                this.timeout(100000);
                await testInstance.waitForState('on');
                await testInstance.waitForAgentReady();
            });

            beforeEach(async function() {
                if (agent === undefined || !agent.connected) {
                    agent = await testInstance.newAgent();
                    await agent.ready();
                }
            });

            after(async function() {
                if (agent !== undefined && agent.connected) {
                    agent.disconnect();
                }
            });

            it('can list device apps', async function() {
                let appList = await agent.appList();
                assert(appList !== undefined && appList.length > 0);
            });

            describe('file control', async function() {
                let expectedData = Buffer.from('D1FF', 'hex');
                let testPath;
                it('can get temp file', async function() {
                    testPath = await agent.tempFile();
                });

                it('can upload a file', async function() {
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

                it('can stat a file', async function() {
                    let stat = await agent.stat(testPath);
                    assert.strictEqual(stat.name, testPath);
                });

                it('can change a files attributes', async function() {
                    await agent.changeFileAttributes(testPath, {mode: 511});
                    let stat = await agent.stat(testPath);
                    assert.strictEqual(stat.mode, 33279);
                });

                it('can download files', async function() {
                    try {
                        let downloaded = await new Promise(resolve => {
                            const rs = agent.download(testPath)
                            let bufs = [];
                            rs.on('data', function (chunk) {
                                bufs.push(chunk);
                            });
                            rs.on('end', function() {
                                resolve(Buffer.concat(bufs));
                            });
                        });

                        assert(Buffer.compare(downloaded, expectedData) === 0);
                    } catch (err) {
                        assert(false, `Error reading downloadable file ${err}`);
                    }
                });

                it('can delete files', async function() {
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

            describe('profiles', async function() {
                if(config.testFlavor === 'ranchu') {
                    // These are unimplemented on ranchu devices
                    it('cannot use profile/list', async function() {
                        assert.rejects(() => agent.profileList());
                    });

                    it('cannot use profile/install', async function() {
                        assert.rejects(() => agent.installProfile('test'));
                    });

                    it('cannot use profile/remove', async function() {
                        assert.rejects(() => agent.removeProfile('test'));
                    });

                    it('cannot use profile/get', async function() {
                        assert.rejects(() => agent.getProfile('test'));
                    });
                }
            });

            describe('locks', async function() {
                if(config.testFlavor === 'ranchu') {
                    // These are unimplemented on ranchu devices
                    it('cannot use lock', async function() {
                        assert.rejects(() => agent.lockDevice());
                    });

                    it('cannot use unlock', async function() {
                        assert.rejects(() => agent.unlockDevice());
                    });

                    it('cannot use acquireDisableAutolockAssertion', async function() {
                        assert.rejects(() => agent.acquireDisableAutolockAssertion());
                    });

                    it('cannot use releaseDisableAutolockAssertion', async function() {
                        assert.rejects(() => agent.releaseDisableAutolockAssertion());
                    });
                }
            });

            describe('wifi', async function() {
                if(config.testFlavor === 'ranchu') {
                    // These are unimplemented on ranchu devices
                    it('cannot use connectToWifi', async function() {
                        assert.rejects(() => agent.connectToWifi());
                    });

                    it('cannot use disconnectFromWifi', async function() {
                        assert.rejects(() => agent.disconnectFromWifi());
                    });
                }
            });

            describe('crashes', async function() {
                // TODO : test for crashes
            })

            describe('app control', async function() {
                let installSuccess;
                it('can install a signed apk', async function() {
                    this.slow(50000);
                    this.timeout(100000);
                    let retries = 3;

                    while (true) {
                        let lastStatus;
                        let rs = fs.createReadStream(path.join(__dirname, 'test.apk'));
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
                                    agent = await testInstance.newAgent();
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

                it('can run an app', async function() {
                    if (!installSuccess)
                    assert(false, "Install of app failed, this test cannot run, artifically forcing a failure");

                    assert.doesNotReject(() => agent.run('com.corellium.test.app'));
                });

                it('can kill an app', async function() {
                    if (!installSuccess)
                        assert(false, "Install of app failed, this test cannot run, artifically forcing a failure");

                    assert.doesNotReject(() => agent.kill('com.corellium.test.app'));
                });

                it('can uninstall an app', async function() {
                    if (!installSuccess)
                        assert(false, "Install of app failed, this test cannot run, artifically forcing a failure");

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

            describe('netmon', function() {
                let netmon;

                it('can get monitor', async function() {
                    netmon = await testInstance.newNetworkMonitor();
                });

                let netmonOutput;
                it('can start monitor', async function() {
                    this.slow(15000);
                    netmon.handleMessage((message) => {
                        let host = message.request.headers.find(entry => entry.key === 'Host');
                        netmonOutput = host.value;
                    });

                    await netmon.start();
                    // Let monitor to start capturing data
                    await new Promise(resolve => setTimeout(resolve, 5000));
                });

                it('can monitor data', async function() {
                    this.slow(15000);
                    await agent.run('org.chromium.webview_shell');
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    assert(netmonOutput == 'clientservices.googleapis.com');
                });

                it('can stop monitor', async function() {
                    await netmon.stop();
                });

                it('can clear log', async function() {
                    await netmon.clearLog();
                });
            });

            describe('frida', function() {
                let pid = 0;
                let name = '';

                it('can get process list', async function() {
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

                it('can get frida scripts', async function() {
                    let fridaScripts = await agent.stat('/data/corellium/frida/scripts/');
                    let scriptList = fridaScripts.entries.map(entry  => entry.name);
                    let s = '';
                    for(s of scriptList) {
                        if (s == 'hook_native.js')
                            break;
                    }
                    assert(s != '');
                });

                it('can get console', async function() {
                    const consoleStream = await testInstance.fridaConsole();
                    // Wait for the socket to open before killing it,
                    // otherwise this will throw an error
                    consoleStream.socket.on('open', function(err) {
                        consoleStream.socket.close();
                    });
                    // When the socket closes, it will be safe to destroy the console duplexify object
                    consoleStream.socket.on('close', function() {
                        consoleStream.destroy();
                    });
                });

                describe('frida attaching and execution', async function() {
        
                    it('can attach frida', async function() {
                        if (name === '') {
                            name = 'keystore';
                        }
                        await agent.runFrida(pid, name);
                    });

                    it('can execute script', async function() {
                        await testInstance.executeFridaScript('/data/corellium/frida/scripts/hook_native.js');
                        await new Promise(resolve => setTimeout(resolve,1000));

                        let fridaConsole = await testInstance.fridaConsole();
                        let fridaOutput = await new Promise(resolve => {
                            const w = new stream.Writable({
                                write(chunk, encoding, callback) {
                                    fridaConsole.destroy();
                                    resolve(chunk);
                                }
                            });
                            fridaConsole.pipe(w);
                        });
                        assert(fridaOutput.toString().includes('Hook android_log_write()'));
                    });

                    it('can detach frida', async function() {
                        await agent.runFridaKill();
                    });
                });
            });
        });

        describe('coretrace', function() {
            let pid = 0;

            it('can get thread list', async function() {
                let threadList = await testInstance.getCoreTraceThreadList();
                for (let p of threadList) {
                    if (p.name.includes("bluetooth@")) {
                        pid = p.pid;
                        break;
                    }
                }
                assert(pid != 0);
            });

            it('can set filter', async function() {
                await testInstance.setCoreTraceFilter([pid], [], []);
            });

            it('can start capture', async function() {
                await testInstance.startCoreTrace();
            });

            it('can capture data', async function() {
                this.slow(15000);
                await new Promise(resolve => setTimeout(resolve, 5000));
                let log = await testInstance.downloadCoreTraceLog();
                assert(log !== undefined);
                assert(log.toString().includes(':bluetooth@'));
            });

            it('can stop capture', async function() {
                await testInstance.stopCoreTrace();
            });

            it('can clear filter', async function() {
                await testInstance.clearCoreTraceFilter();
            });

            it('can clear log', async function() {
                await testInstance.clearCoreTraceLog();
            });
        });

        async function turnOn() {
            await testInstance.start();
            await testInstance.waitForState('on');
            assert.strictEqual(testInstance.state, 'on');
        }

        async function turnOff() {
            await testInstance.stop();
            await testInstance.waitForState('off');
            assert.strictEqual(testInstance.state, 'off');
        }

        describe('device life cycle', function() {
            it('can pause', async function() {
                await testInstance.waitForState('on');
                await testInstance.pause();
                await testInstance.waitForState('paused');
            });

            it('can unpause', async function() {
                if (testInstance.state !== 'paused') {
                    await testInstance.pause();
                    await testInstance.waitForState('paused');
                }

                await testInstance.unpause();
                await testInstance.waitForState('on');
                await testInstance.update();
            });

            it('can reboot', async function() {
                this.slow(20000);
                this.timeout(25000);
                if (testInstance.state !== 'on') {
                    await turnOn(testInstance);
                }
                await testInstance.reboot();
            });

            it('can stop', async function() {
                this.slow(15000);
                if (testInstance.state !== 'on') {
                    await turnOn(testInstance);
                }
                await turnOff(testInstance);
            });

            it('can start', async function() {
                this.slow(20000);
                this.timeout(25000);
                if (testInstance.state !== 'off') {
                    await turnOff(testInstance);
                }
                await turnOn(testInstance);
            });
        });

        describe('snapshots', function() {
            before(async function() {
                await testInstance.update();
            });

            it('has a fresh snapshot', async function() {
                const snapshots = await testInstance.snapshots();
                const fresh = snapshots.find(snap => snap.fresh);
                assert(fresh !== undefined);
            });

            it('refuses to take snapshot if instance is on', async function() {
                if (testInstance.state !== 'on') {
                    await turnOn(testInstance);
                }
                await assert.rejects(() => testInstance.takeSnapshot());
            });

            let latest_snapshot;
            it('can take snapshot if instance is off', async function() {
                if (testInstance.state !== 'off') {
                    await turnOff(testInstance);
                }

                latest_snapshot = await testInstance.takeSnapshot();
            });

            it('can restore a snapshot', async function() {
                if (testInstance.state !== 'off') {
                    await turnOff(testInstance);
                }

                assert.doesNotReject(() => latest_snapshot.restore());
            });

            it('can delete a snapshot', async function() {
                if (testInstance.state !== 'off') {
                    await turnOff(testInstance);
                }

                assert.doesNotReject(() => latest_snapshot.delete());
            });
        });
    });
});
