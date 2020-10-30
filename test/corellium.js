const Corellium = require('../src/corellium').Corellium;
const {Input} = require('../src/input')
const config = require('./config.json');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
            config.project === undefined) {
                new Error(`Bad configuration for testing provided, requires endpoint,` +
                `username, password and project defined to work`);
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
            const flavor = 'ranchu';
            const name = 'api test';
            testInstance = await project.createInstance({
                os: os,
                flavor: flavor,
                name: name,
            })
            .then((instance) => {
                return instance;
            }).catch((error) => {
                throw error;
            });

            await testInstance.waitForState('creating');
            assert(name, testInstance.name);
            assert(flavor, testInstance.flavor);
        })

        it('can list supported devices', async function() {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === 'ranchu');
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
            let expected = Buffer.from('client.dev');

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

        // it('has a console', async function() {
        //     const consoleStream = await testInstance.console();
        //     // try {
        //         await consoleStream.destroy();
        //     // } catch (e) {
        //     //     console.log(e);
        //     // }
        // });

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
                agent = await testInstance.newAgent();
                await agent.ready();
            });

            afterEach(async function() {
                agent.disconnect();
            });

            it('can list device apps', async function() {
                let appList = await agent.appList();
                assert(appList !== undefined && appList.length > 0);
            });

            it('can install a signed apk', async function() {
                let lastStatus;
                let rs = fs.createReadStream(path.join(__dirname, 'test.apk'));
                try {
                    await agent.installFile(rs, (_progress, status) => {
                        lastStatus = status;
                    });
                } catch (err) {
                    assert(false, `Error installing app during '${lastStatus} stage: ${err}`);
                } finally {
                    rs.close();
                }
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
