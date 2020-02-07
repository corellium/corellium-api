const Corellium = require('../src/corellium').Corellium;
const config = require('./config.json');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/** @typedef {import('../src/project.js')} Project */
/** @typedef {import('../src/instance.js')} Instance */

describe('Corellium API', function() {
    this.slow(10000);
    this.timeout(20000);

    const corellium = new Corellium(config);
    it('logs in successfully', async function() {
        await corellium.login();
    });

    it('lists projects', async function() {
        const projects = await corellium.projects();
        if (projects.find(project => project.info.name === config.project) === undefined)
            new Error(`Your test config specifies a project named "${config.project}", ` +
                      `but no such project was found on ${config.endpoint}`);
    });

    describe('instances', function() {
        let instance = /** @type {Instance} */(null),
            project = /** @type {Project} */(null);
        before(async function() {
            const projects = await corellium.projects();
            project = projects.find(project => project.info.name === config.project);
            const instances = await project.instances();
            instance = instances[0];
            if (instance === undefined)
                throw new Error('no device found in specified project, please create one');
        });

        it('can add and remove keys', async function() {
            const keyInfo = await project.addKey(
                'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCqpvRmc/JQoH9P6XVlHnod0wRCg+7iSGfpyoBoe+nWwp2iEqPyM7A2RzW7ZIX2FZmlD5ldR6Oj5Z+LUR/GXfCFQvpQkidL5htzGMoI59SwntpSMvHlFLOcbyS7VmI4MKbdIF+UrelPCcCJjOaZIFOJfNtuLWDx0L14jW/4wflzcj6Fd1rBTVh2SB3mvhsraOuv9an74zr/PMSHtpFnt5m4SYWpE4HLTf0FJksEe/Qda9jQu5i86Mhu6ewSAVccUDLzgz6E4i8hvSqfctcYGT7asqxsubPTpTPfuOkc3WOxlqZYnnAbpGh8NvCu9uC+5gfWRcLoyRBE4J2Y3wcfOueP example-key'
            );

            assert(keyInfo.label === 'example-key', 'label defaults to public key comment');
            assert(keyInfo.fingerprint === '9c:71:e5:40:08:fb:cd:88:1b:6d:8e:4f:c0:4c:0f:dd');

            const keys = await project.keys();
            assert(!!keys.find(key => key.identifier === keyInfo.identifier));

            await project.deleteKey(keyInfo.identifier);
        });

        it('lists supported devices', async function() {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === 'iphone6');
            assert(firmware);
        });

        it('can create and delete', async function() {
            const instance = await project.createInstance({os: '11.2.6', flavor: 'iphone6'});
            await instance.waitForState('creating');
            await instance.destroy();
            await instance.waitForState('deleting');
        });

        it('can rename', async function() {
            async function rename(name) {
                await instance.rename(name);
                await instance.update();
                assert.equal(instance.name, name);
            }
            await rename('foo');
            await rename('bar');
        });

        async function turnOn() {
            await instance.start();
            await instance.waitForState('on');
            assert.equal(instance.state, 'on');
        }
        async function turnOff() {
            await instance.stop();
            await instance.waitForState('off');
            assert.equal(instance.state, 'off');
        }

        it('has a console', async function() {
            await turnOn(instance);
            await instance.console();
        });

        it('can stop', async function() {
            await turnOn(instance);
            await turnOff(instance);
        });
        it('can start', async function() {
            await turnOff(instance);
            await turnOn(instance);
        });

        describe('snapshots', function() {
            it('has a fresh snapshot', async function() {
                const snapshots = await instance.snapshots();
                const fresh = snapshots.find(snap => snap.fresh);
                assert(fresh !== undefined);
            });

            it('can take, restore, and delete snapshots', async function() {
                await turnOff(instance);
                const modified = await instance.takeSnapshot('modified');
                await modified.restore();
                await modified.delete();
            });

            it('refuses to take snapshot if instance is on', async function() {
                await turnOn(instance);
                await assert.rejects(() => instance.takeSnapshot());
            });
        });

        describe('apps', function() {
            let agent;
            before(async function() {
                await turnOn(instance);
                agent = await instance.agent();
            });

            describe('installation', async function() {
                let lastStatus;
                it('should succeed with signed app', async function() {
                    try {
                        await agent.installFile(fs.createReadStream(path.join(__dirname, 'Red_signed.ipa')), (_progress, status) => {
                            lastStatus = status;
                        });
                    } catch (err) {
                        assert(false, `Error installing app during '${lastStatus} stage: ${err}`);
                    }
                });

                it('should fail with unsigned app', async function() {
                    try {
                        await agent.installFile(fs.createReadStream(path.join(__dirname, 'Red.ipa')), (_progress, status) => {
                            lastStatus = status;
                        });
                        assert(false, 'Installation should fail.');
                    } catch (err) {}
                });
            });
        });
    });
});
