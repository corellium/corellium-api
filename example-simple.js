const { Corellium } = require("./src/corellium");
const fs = require("fs");

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
  let project = projects[0];

  console.log("Getting instances...");
  let instances = await project.instances();

  // Assuming you used that name for your Android device; if you left it alone, it's 'Android'
  let instance = instances.find(
    (instance) => instance.name === "My First Device"
  );

  console.log("Getting agent...");
  let agent = await instance.agent();

  console.log("Waiting until agent is ready...");
  await agent.ready();

  console.log("Installing App...");

  await agent.installFile(
    fs.createReadStream("test.apk"),
    (progress, status) => {
      console.log(progress, status);
    }
  );

  console.log("App installed");

  console.log("Starting App...");
  await agent.run("com.testable.app");

  await agent.disconnect();

  return;
}

main().catch((err) => {
  console.error(err);
});
