const { Corellium } = require("@corellium/corellium-api");
const Project = require("@corellium/corellium-api/src/project");
const fs = require("fs");
const process = require("process");

let ActiveInstances = 0;
let ShutoffInstances = 0;

// Specify your domain's endpoint.
let myEndPoint = "https://awesomedomain.enterprise.corellium.com";
// Create an enviromental variable for your API token.
let apiToken = process.env["CORELLIUM_API_TOKEN"];

// Sets up a new Corellium endpoint to use.
let corellium = new Corellium({
  endpoint: myEndPoint,
  apiToken: apiToken,
});

main();
async function main() {
  // If you are seeing certificate issues when executing the script, try uncommenting this line.
  // process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;  
  var args = process.argv;

  // command line arguments that are accepted.
  const commands = ["--domain", "--projectID", "--projectName", "--help"];

  // Displays all arguments that can be used with this script.
  const usage = function () {
    const usageText = `
    You must specify the following:

    Specify a project ID         --projectID
    Specify a project Name       --projectName     
    Issues shutoff on the domain --domain
    `
    console.log(usageText);
  }

  // Displays usage if too many arguments are received. 
  if (args.length > 4) {
    console.log(`Only one argument can be accepted.`)
    usage();
    process.exit(3);
  }

  corellium.login();

  // Calls a specific function depending on the command received.
  switch (args[2]) {
    case "--help":
      usage();
      process.exit(0);
    case "--domain":
      await shutoffDomain();
      break;
    case "--projectName":
      await shutoffProjectName(args[3]);
      break;
    case "--projectID":
      await shutoffProject(args[3]);
      break;
    default:
      console.log("Invalid command passed.");
      usage();
      process.exit(1);
  }
  console.log("Total number of instances on before issuing shut off: " + ActiveInstances);
  console.log("Total number of instances that were shut off: " + ShutoffInstances);
}

async function shutoffDomain() {
  let projects = await corellium.projects();
  for (let p = 0; p < projects.length; p++) {
    // Calls the shutoffProject function passing in each project ID in your domain.
    await shutoffProject(projects[p].id);
  }
}

async function shutoffProjectName(projectName) {
  let projects = await corellium.projects();
  for (let p = 0; p < projects.length; p++) {
    // Checks the project name against each project in your domain.
    if (projectName == projects[p].info.name) {
      // This line only executes if the if condition returns true.
      await shutoffProject(projects[p].id);
    }
  }
}

// Does the bulk of the instance shutoff except for unique cases.
async function stopInstance(instance) {
  try {
    await instance.stop();
    await instance.waitForState("off");
    ShutoffInstances++;
    console.log("Instance " + instance.info.name + " " + instance.id + " is now off.");
  } catch (error) {
    console.error(error);
    console.log("Instance failed to stop.");
  }
}

// Function takes a project ID as an input then issues the shutoff to all instances contained in that project.
async function shutoffProject(projectID) {
  let projects = await corellium.projects();
  for (let p = 0; p < projects.length; p++) {
    // Checks project ID input against all projects in the domain.
    if (projectID == projects[p].id) {
      ShutdownID = projects[p];
    }
  }

  let instances = await ShutdownID.instances();
  for (let i = 0; i < instances.length; i++) {
    // Handles each instance state.
    switch (instances[i].state) {
      case "on":
        ActiveInstances++;
        console.log("Stopping active instance " + instances[i].id + "...");
        await stopInstance(instances[i]);
        break;
      case "off":
        console.log("Instance " + instances[i].id + " is already off");
        break;
      case "creating":
        console.log("Waiting for instance creation " + instances[i].id + "...");
        await instances[i].waitForState("on");
        console.log("Creation done, shutting off the instance.");
        await stopInstance(instances[i]);
        break;
      case "deleting":
        console.log("Instance " + instances[i].id + " is being deleted");
        break;
      case "restoring":
        console.log("Waiting for instance restore " + instances[i].id + "...");
        await instances[i].waitForState("on");
        console.log("Restore done, shutting off the instance.");
        await stopInstance(instances[i]);
        break;
      case "paused":
        console.log("Stopping paused instance for " + instances[i].id + "...");
        await stopInstance(instances[i]);
        break;
      case "booting":
        console.log("Stopping booting instance for " + instances[i].id + "...");
        await instances[i].waitForState("on");
        await stopInstance(instances[i]);
        break;
      case "rebooting":
        console.log("Waiting for instance to finish rebooting " + instances[i].id + "...");
        await instances[i].waitForState("on");
        console.log("Reboot done, shutting off the instance...");
        await stopInstance(instances[i]);
        break;
      case "error":
        console.log("Instance " + instances[i].id + " is off and in an error state.");
    }
  }
}