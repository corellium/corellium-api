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

    console.log('Getting agent...');
    let agent = await instances[0].agent();

    console.log('Waiting until agent is ready...');
    await agent.ready();
    
    console.log('Agent is ready.');

    let path = await agent.tempFile();
    console.log(path);

    return;
    await agent.upload(path, fs.createReadStream('fb.ipa'));
    
    console.log('uploaded');

    return;
}

main().catch(err => {
    console.error(err);
});
