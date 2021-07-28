const { Corellium } = require("../src/corellium");

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: "https://app.corellium.com",
        username: "user@name.foo",
        password: "<password>",
        totpToken: "123456",
    });

    console.log("Logging in...");
    // Login.
    await corellium.login();

    console.log("Getting projects list...");
    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "Default Project".
    let project = projects.find((project) => project.name === "Testing");

    // Get the instances in the project.
    console.log("Getting instances...");
    let instances = await project.instances();

    let instance = instances.find(
        (instance) => instance.id === "fc5926e8-a41a-43b6-98f2-4d0d8e3de0fa",
    );

    console.log("Got instance");
    await instance.waitForAgentReady();
    let agent = await instance.agent();
    console.log("Got agent");

    await agent.ready();
    console.log("Agent ready");

    agent.disconnect();

    return;
}

main().catch((err) => {
    console.error(err);
});
