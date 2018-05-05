const Corellium = require('../src/corellium').Corellium;
const config = require('./config.json');
const assert = require('assert');
const util = require('util');

describe('Corellium API', function() {
    this.slow(10000);
    this.timeout(20000);

    const corellium = new Corellium(config);
    it('logs in successfully', async function() {
        await corellium.login();
    });

    let project;
    it('lists projects', async function() {
        const projects = await corellium.projects();
        project = projects.find(project => project.info.name === config.project);
    });

    describe('instances', function() {
        let instance;
        before(async function() {
            this.timeout(20000);
            const instances = await project.instances();
            instance = instances[0];
            if (instance === undefined)
                throw new Error('no device found in specified project, please create one');
        });

        it('lists supported devices', async function() {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === 'iphone6');
            assert(firmware);
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
    });
});
