const Corellium = require('../src/corellium').Corellium;
const config = require('./config.json');
const assert = require('assert');

describe('Corellium API', function() {
    this.slow(2000);
    this.timeout(60000);

    const corellium = new Corellium(config);
    it('logs in successfully', async function() {
        await corellium.login();
    });

    describe('instances', () => {
        let project;
        let instance;
        before(async function() {
            const projects = await corellium.projects();
            project = projects.find(project => project.info.name === config.project);

            const instances = await project.instances();
            instance = instances[0];
            await instance.start();
            await instance.update();
        });

        it('lists supported devices', async function() {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(device => device.name === 'iphone6');
            assert(firmware);
        });

        it('can start and stop', async function() {
            assert.equal(instance.status, 'off');
            await instance.stop();
            // there's no way to wait for it to actually shut down
            // assert.equal(instance.status(), 'SHUTOFF');
            await instance.start();
            assert.equal(instance.status, 'on');
        });
    });
});
