const {Corellium} = require('./src/corellium');
const fs = require('fs');

async function launch(instance, bundleID) {
    let agent = await instance.agent();
    let retries = 10;
    while (true) {
        try {
            await agent.run(bundleID);
            break;
        } catch (e) {
            if (e.message === 'Screen is locked. Please unlock device and run again.') {
                await instance.buttons.pressAndRelease('home');
                continue;
            }

            --retries;
            if (retries !== 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            throw e;
        }
    }
}

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: 'https://pdev2.corellium.com',
        username: 'admin',
        password: 'password'
    });

    console.log('Logging in...');
    // Login.
    await corellium.login();

    console.log('Getting projects list...');
    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "David's Project".
    let project = projects.find(project => project.name === "Default Project");

    // Get the instances in the project.
    console.log('Getting instances...');
    let instances = await project.instances();
    let instance = instances.find(instance => instance.name === 'API Demo');

    console.log('Getting agent...');
    let agent = await instance.agent();

    console.log('Waiting until agent is ready...');
    await agent.ready();
    
    console.log('Agent is ready.');
    
    let appList = await agent.appList();
    let apps = new Map();
    for (let app of await agent.appList()) {
        apps.set(app['bundleID'], app);
    }

    console.log(apps);

    if (!apps.get('com.facebook.Facebook')) {
        console.log('Installing Facebook...');

        await agent.installFile(fs.createReadStream('fb.ipa'), (progress, status) => {
            console.log(progress, status);
        });

        console.log('Facebook installed');
    }

    console.log('Unlocking device');
    await agent.unlockDevice();

    for (let [, app] of apps) {
        let crashListener = await instance.newAgent();
        console.log('Running ' + app['bundleID']);
        let timeout = null;
        let timeoutComplete = null;
        let crashed = false;

        crashListener.crashes(app['bundleID'], (err, crashReport) => {
            if (err) {
                console.error(err);
                return;
            }

            if (timeout) {
                clearTimeout(timeout);
                timeoutComplete();
            }

            console.log(crashReport);
            crashed = true;
        });

        await launch(instance, app['bundleID']);

        await new Promise(resolve => {
            timeoutComplete = resolve;
            timeout = setTimeout(timeoutComplete, 15000);
        });

        timeout = null;

        if (!crashed) {
            console.log('Killing ' + app['bundleID']);

            try {
                await agent.kill(app['bundleID']);
            } catch (e) {
                console.error(e);
            }
        }

        crashListener.disconnect();
    }

    return;
}

main().catch(err => {
    console.error(err);
});
