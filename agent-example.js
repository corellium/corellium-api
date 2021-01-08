"use strict";

const { Corellium } = require("./src/corellium");
const { I } = require("./src/input");

async function launch(instance, bundleID) {
    let agent = await instance.agent();
    let retries = 10;

    // Try ten times to launch the app. If the screen is locked, push the home button (which wakes or unlocks the phone).
    while (true) {
        try {
            await agent.run(bundleID);
            break;
        } catch (e) {
            if (e.name === "DeviceLocked") {
                await instance.sendInput(I.pressRelease("home"));
                continue;
            }

            --retries;
            if (retries !== 0) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            throw e;
        }
    }
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

    let supported = await corellium.supported();
    console.log("Supported:", supported);

    let teams,
        users = await corellium.getTeamsAndUsers();
    console.log("teams:", teams);
    console.log("users:", users);

    // Find the project called "Default Project".
    let project = projects.find((project) => project.name === "Test Project");

    // Get the instances in the project.
    console.log("Getting instances...");
    let instances = await project.instances();

    // Use an instance named "API Demo"
    let instance = instances.find((instance) => instance.name === "latest");

    // Wait for the agent to respond.
    console.log("Getting agent...");
    let agent = await instance.agent();

    // Wait for SpringBoard to finish loading.
    console.log("Waiting until agent is ready...");
    await agent.ready();

    console.log("Agent is ready.");

    // List the apps.
    let appList = await agent.appList();
    let apps = new Map();
    for (let app of appList) {
        if (app["bundleID"] === "com.corellium.test.app") {
            apps.set(app["bundleID"], app);
        }
    }

    console.log(apps);

    // Install the Facebook IPA if it's not already installed.
    // if (!apps.get('com.facebook.Facebook')) {
    //     console.log('Installing Facebook...');

    //     await agent.installFile(fs.createReadStream('fb.ipa'), (progress, status) => {
    //         console.log(progress, status);
    //     });

    //     console.log('Facebook installed');
    // }

    // Unlock the device.
    // console.log('Unlocking device');
    // await agent.unlockDevice();

    // Run each app while listening for crashes of that app. Wait 15 seconds and kill the app.
    for (let [, app] of apps) {
        // Create a crash listenr.
        let crashListener = await instance.newAgent();
        console.log("Running " + app["bundleID"]);
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
            console.log("Killing " + app["bundleID"]);

            try {
                await agent.kill(app["bundleID"]);
            } catch (e) {
                console.error(e);
            }
        }

        // Stop the crash listener.
        crashListener.disconnect();
    }

    return;
}

main().catch((err) => {
    console.error(err);
});
