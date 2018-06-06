const {Corellium} = require('./src/corellium');
const fs = require('fs');

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
    let instance = instances[0];

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

    for (let [, app] of apps) {
        let crashListener = await instance.newAgent();
        console.log('Running ' + app['bundleID']);
        crashListener.crashes(app['bundleID'], (err, crashReport) => {
            if (err) {
                console.error(err);
                return;
            }

            console.log(crashReport);
        });

        await agent.run(app['bundleID']);
        await new Promise(resolve => setTimeout(resolve, 15000));
        console.log('Killing ' + app['bundleID']);
        await agent.kill(app['bundleID']);

        crashListener.disconnect();
    }

    return;
}

main().catch(err => {
    console.error(err);
});
