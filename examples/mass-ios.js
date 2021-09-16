const { Corellium } = require("@corellium/corellium-api");

function versionParse(version) {
    let parts = version.split(".");
    return {
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0,
    };
}

function versionCompare(a, b) {
    if (a.major < b.major) return -1;

    if (a.major > b.major) return 1;

    if (a.minor < b.minor) return -1;

    if (a.minor > b.minor) return 1;

    if (a.patch < b.patch) return -1;

    if (a.patch > b.patch) return 1;

    return 0;
}

async function launch(instance, bundleID) {
    let agent = await instance.agent();
    let retries = 10;

    // Try ten times to launch the app. If the screen is locked, push the home button (which wakes or unlocks the phone).
    do {
        try {
            await agent.run(bundleID);
            return;
        } catch (e) {
            if (e.name === "DeviceLocked") {
                await instance.sendInput(Corellium.I.pressRelease("home"));
                continue;
            }

            --retries;
            if (retries !== 0) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            throw e;
        }
    } while (retries > 0);

    throw new Error(`Unable to launch ${bundleID}.`);
}

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: "https://app.corellium.com",
        username: "user@name.foo",
        password: "<password>",
    });

    console.log("Logging in...");

    // Login.
    await corellium.login();

    console.log("Getting projects list...");
    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "Default Project".
    let project = projects.find((project) => project.name === "Default Project");

    // Create map of supported devices.
    let supported = {};
    (await corellium.supported()).forEach((modelInfo) => {
        supported[modelInfo.name] = modelInfo;
    });

    // Get how many CPUs we're currently using.
    let cpusUsed = project.quotasUsed.cpus;

    console.log("Used: " + cpusUsed + "/" + project.quotas.cpus);

    // Sort firmware supported by each device from latest to earliest.
    let toDeploy = [];
    let sortedVersions = new Map();
    for (let flavorId of Object.keys(supported)) {
        let flavor = supported[flavorId];
        let versions = flavor["firmwares"].slice().sort((a, b) => {
            return -versionCompare(versionParse(a.version), versionParse(b.version));
        });
        sortedVersions.set(flavorId, versions);
    }

    // Generate a list of virtual devices to start by looping through each model and taking the latest version we haven't started yet, until we run out of cpus.
    while (cpusUsed < project.quotas.cpus) {
        let added = 0;
        for (let flavorId of Object.keys(supported)) {
            let flavor = supported[flavorId];
            let versions = sortedVersions.get(flavorId);
            if (versions.length === 0) continue;

            let version = versions.shift();

            toDeploy.push({
                flavor: flavorId,
                version: version.version,
            });

            if (cpusUsed + flavor.quotas.cpus > project.quotas.cpus) continue;

            cpusUsed += flavor.quotas.cpus;
            ++added;
        }

        if (added === 0) break;
    }

    for (let vm of toDeploy) {
        // Start the devices.
        console.log("starting", vm);
        project
            .createInstance({
                flavor: vm.flavor,
                os: vm.version,
            })
            .then(async (instance) => {
                // Finish restoring the device.
                await instance.finishRestore();
                console.log("finished restoring", vm);

                // Wait for the agent to start working on device and report that SpringBoard is started.
                await instance.waitForAgentReady();
                console.log("waiting for agent", vm);
                let agent = await instance.agent();
                console.log("connected to agent", vm);
                await agent.ready();
                console.log("device is booted", vm);

                // Get a list of apps.
                let appList = await agent.appList();
                let apps = new Map();
                for (let app of appList) {
                    apps.set(app["bundleID"], app);
                }

                // Run each app while listening for crashes of that app. Wait 15 seconds and kill the app.
                for (let [, app] of apps) {
                    // Create a crash listenr.
                    let crashListener = await instance.newAgent();
                    console.log(vm, "Running " + app["bundleID"]);
                    let timeout = null;
                    let timeoutComplete = null;
                    let crashed = false;

                    crashListener.crashes(app["bundleID"], (err, crashReport) => {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        // If we're waiting the 15 seconds, stop waiting.
                        if (timeout) {
                            clearTimeout(timeout);
                            timeoutComplete();
                        }

                        console.log(crashReport);
                        crashed = true;
                    });

                    // Run the app.
                    await launch(instance, app["bundleID"]);

                    // Wait 15 seconds, while letting the crash listener interrupt it if necessary.
                    await new Promise((resolve) => {
                        timeoutComplete = resolve;
                        timeout = setTimeout(timeoutComplete, 15000);
                    });

                    timeout = null;

                    // If there were no crashes, kill the app.
                    if (!crashed) {
                        console.log(vm, "Killing " + app["bundleID"]);

                        try {
                            await agent.kill(app["bundleID"]);
                        } catch (e) {
                            console.error(e);
                        }
                    }

                    // Stop the crash listener.
                    crashListener.disconnect();
                }
            });
    }
}

main().catch((err) => {
    console.error(err);
});
