const { Corellium } = require("./src/corellium");

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: "https://app.corellium.com",
        username: "user@name.foo",
        password: "<password>",
    });

    console.log("Logging in...");
    await corellium.login();

    console.log("Getting projects list...");
    let projects = await corellium.projects();

    // Individual accounts have a default project
    let project = projects.find((project) => project.name === "Test Project");

    console.log("Getting instances...");
    let instances = await project.instances();

    // Assuming you used that name for your Android device; if you left it alone, it's 'Android'
    let instance = instances.find((instance) => instance.name === "latest");

    console.log("Creating agent...");
    let agent = await instance.newAgent();

    console.log("Waiting until agent is ready...");
    await agent.ready();

    console.log("Listening for crashes...");
    agent.crashes("com.corellium.test.app", (err, crashReport) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(crashReport);
    });

    return;
}

main().catch((err) => {
    console.error(err);
});
