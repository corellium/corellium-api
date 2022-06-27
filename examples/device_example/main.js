const { Corellium } = require("@corellium/corellium-api");
const fs = require("fs");

async function main() {
    // ACCOUNT CREDENTIALS
    let myEndPoint = "https://app.corellium.com";
    let myUserName = "user@name.foo";
    let myPassword = "<password>";
    let myProject = "Example Project Name";

    // CREDENTIALS/CONFIGURATIONS
    let myDeviceName = "API Android";
    let myFlavor = "ranchu";
    let myOS = "11.0.0";
    let myFile = "devicetree";
    let myFilePath = "./devicetree";

    // Sets up a new Corellium endpoint to use
    let corellium = new Corellium({
        endpoint: myEndPoint,
        username: myUserName,
        password: myPassword,
    });

    // Login.
    console.log("[+] Logging in...");
    await corellium.login();

    // Get the list of projects.
    let project;
    let projects = await corellium.projects().catch((e) => console.log(e));

    if (projects) {
        // Find the project called myProject.
        console.log("[+] Getting the project named " + myProject);
        project = await projects.find((project) => project.name === myProject);
        if (!project) {
            console.log("[!] There is no project named " + myProject);
            return;
        } else {
            console.log("[+] Found the " + myProject + " project.");
        }
    } else {
        console.log("[!] You don't have any projects.");
        return;
    }

    // Get the instances in the project.
    console.log("[+] Getting instances...");
    let instances = await project.instances();

    // Send the list of instances to the console
    for (let i = 0; i < instances.length; i++) {
        console.log("[+] Found instance named " + instances[i].info.name);
    }

    // Find the instance
    let instance = instances.find((instance) => instance.name === myDeviceName);

    if (!instance) {
        // Create the device
        console.log(
            "[!] " +
                myDeviceName +
                " device not found. \n[+] Creating a " +
                myFlavor +
                " device...",
        );
        instance = await project.createInstance({
            flavor: myFlavor,
            os: myOS,
            name: myDeviceName,
        });
    } else {
        if (instance.state === "off") {
            console.log("[+] Turning on the device...");
            await instance.start();
        } else {
            console.log("[+] Rebooting the device...");
            await instance.reboot();
        }
    }
    await instance.waitForState("on");

    // Check how many snapshots are already on this instance
    let snapshots = await instance.snapshots();
    if (snapshots.length < 5) {
        console.log("[+] Turning off the device...");
        await instance.stop();
        await instance.waitForTaskState("none");

        console.log("[+] Taking a snapshot...");
        await instance.takeSnapshot("TestSnapshot");
        await instance.waitForTaskState("none");
    } else {
        console.log("[!] Can't have more than 5 snapshots.");
    }

    // Upload the custom devicetree
    console.log("[+] Uploading custom devicetree...");
    if (fs.existsSync(myFilePath)) {
        await instance.uploadDeviceTree(myFilePath, myFile);
    } else {
        console.log(
            "[!] You must include a file to upload. \n    Download an example devicetree here: https://s3.us-east-2.amazonaws.com/files.s3.corellium.com/corellium-api/examples/device_example/devicetree",
        );
    }

    await instance.waitForTaskState("none");

    console.log("[+] Done!");
    return;
}

main().catch((err) => {
    console.error(err);
});
