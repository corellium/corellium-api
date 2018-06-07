const {Corellium} = require('./src/corellium');
const fs = require('fs');

function versionParse(version) {
    let parts = version.split('.');
    return {
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0
    };
}

function versionCompare(a, b) {
    if (a.major < b.major)
        return -1;
    
    if (a.major > b.major)
        return 1;
    
    if (a.minor < b.minor)
        return -1;
    
    if (a.minor > b.minor)
        return 1;
    
    if (a.patch < b.patch)
        return -1;
    
    if (a.patch > b.patch)
        return 1;

    return 0;
}

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
        endpoint: 'https://client.corellium.com',
        username: 'admin',
        password: 'password'
    });

    console.log('Logging in...');
    // Login.
    await corellium.login();

    console.log('Getting projects list...');
    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "Default Project".
    let project = projects.find(project => project.name === "Default Project");

    // Get the instances in the project.
    console.log('Getting instances...');
    let instances = await project.instances();

    let supported = {};

    (await corellium.supported()).forEach(modelInfo => {
        supported[modelInfo.name] = modelInfo;
    });

    let cpusUsed = 0;
    instances.forEach(instance => {
        cpusUsed += supported[instance.flavor].quotas.cpus;
    });

    console.log('Used: ' + cpusUsed + '/' + project.quotas.cpus);

    let toDeploy = [];
    let sortedVersions = new Map();
    for (let flavorId of Object.keys(supported)) {
        let flavor = supported[flavorId];
        let versions = flavor['firmwares'].slice().sort((a, b) => {
            return -versionCompare(versionParse(a.version), versionParse(b.version));
        });
        sortedVersions.set(flavorId, versions);
    }

    while(cpusUsed < project.quotas.cpus) {
        for (let flavorId of Object.keys(supported)) {
            let flavor = supported[flavorId];
            let versions = sortedVersions.get(flavorId);
            if (versions.length === 0)
                continue;

            let version = versions.shift();

            toDeploy.push({
                flavor: flavorId,
                version: version.version
            });

            if ((cpusUsed + flavor.quotas.cpus) > project.quotas.cpus)
                continue;

            cpusUsed += flavor.quotas.cpus;
        }
    }

    for (let vm of toDeploy) {
        project.createInstance({
            'flavor': vm.flavor,
            'os': vm.version
        }).then(async instance => {
            await instance.finishRestore();
            console.log('finished restoring', vm);
            await new Promise(async resolve => {
                while (true) {
                    try {
                        console.log('waiting for agent', vm);
                        let agent = await instance.agent();
                        console.log('connected to agent', vm);
                        await agent.ready();
                        break;
                    } catch(e) {
                        console.error(e);
                    }
                }

                resolve();
            });
            console.log('device is booted', vm);

            let agent = await instance.agent();
            let appList = await agent.appList();
            let apps = new Map();
            for (let app of await agent.appList()) {
                apps.set(app['bundleID'], app);
            }

            for (let [, app] of apps) {
                let crashListener = await instance.newAgent();
                console.log(vm, 'Running ' + app['bundleID']);
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
                    console.log(vm, 'Killing ' + app['bundleID']);

                    try {
                        await agent.kill(app['bundleID']);
                    } catch (e) {
                        console.error(e);
                    }
                }

                crashListener.disconnect();
            }
        });
    }
}

main().catch(err => {
    console.error(err);
});
