const { Corellium } = require("../src/corellium");
const es = require("event-stream");
const stripAnsi = require("strip-ansi");
const yargs = require("yargs/yargs");

const argv = yargs(process.argv).argv;

function usage() {
    console.log(
        "Usage: " +
            argv._[1] +
            " [--endpoint <endpoint>] --user <user> --password <pw> --project <project> [create | inplace <uuid>] console_cmd...",
    );
    process.exit(-1);
}

const cmd = argv._[2];
const user = argv.user;
const pw = argv.password;
const projectName = argv.project;
var endpoint = "https://app.corellium.com";
let console_cmd = "";

if (argv.endpoint !== undefined) {
    endpoint = argv.endpoint;
}

var uuid;
if (cmd == "inplace") {
    uuid = argv._[3];
    if (uuid == undefined) {
        console.log("uuid missing");
        usage();
    }
    for (var i = 4; i < argv._.length; i++) {
        if (console_cmd.length != 0) console_cmd += " ";
        console_cmd += argv._[i];
    }
} else if (cmd == "create") {
    for (i = 3; i < argv._.length; i++) {
        if (console_cmd.length != 0) console_cmd += " ";
        console_cmd += argv._[i];
    }
} else {
    console.log("create or inplace expected");
    usage();
}

if (user == undefined || pw == undefined) {
    console.log("username and password must be specified");
    usage();
}
if (projectName == undefined) {
    console.log("project name must be specified");
    usage();
}

if (console_cmd.length == 0) {
    console.log("No console command to execute specified");
    usage();
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: endpoint,
        username: user,
        password: pw,
    });

    console.log("Logging in...");
    // Login.
    await corellium.login();

    console.log("Getting projects list...");
    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "Default Project".
    let project = projects.find((project) => project.name == projectName);

    let instance;
    if (cmd == "inplace") {
        // Get the instances in the project.
        console.log("Getting instances...");
        let instances = await project.instances();

        instance = instances.find((instance) => instance.id === uuid);

        if (instance == undefined) {
            console.log("uuid " + uuid + " not found");
            process.exit(-1);
        }
    } else if (cmd == "create") {
        console.log("Creating instance");
        const instance = await project.createInstance({
            flavor: "iphone6s",
            os: "12.0",
            name: "Console test",
            osbuild: "16A366",
            patches: "jailbroken",
        });
        console.log("Waiting for restore to finish");
        await instance.finishRestore();
        console.log("Waiting to turn on");
        await instance.waitForState("on");
        console.log("Instance on");
    }

    console.log("Waiting for agent");
    await instance.waitForAgentReady();
    var agent = await instance.agent();
    console.log("Agent obtained");

    let consoleStream = await instance.console();
    console.log("Console obtained");

    await agent.ready();

    //  Wait for 1s for the existing console buffer to be received, then read it to flush it out
    await sleep(1000);
    consoleStream.read();

    //  Install handler to parse console output line by line
    let streamHandler = es.split();
    consoleStream.pipe(streamHandler).pipe(
        es
            .mapSync(function (line) {
                line = stripAnsi(line);
                line = line.replace(/[\n\r]+/g, "");
                console.log(line);
            })
            .on("error", function (err) {
                console.log("Error while reading file.", err);
            })
            .on("end", function () {
                console.log("Read entire file.");
            }),
    );

    //  Execute command
    await consoleStream.write(console_cmd + "\r\n");

    //  Wait for command to complete
    await sleep(5000);

    await consoleStream.write("Done.");
    await agent.disconnect();

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
});
