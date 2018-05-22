const Corellium = require('./src/corellium').Corellium;

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        endpoint: 'https://pdev2.corellium.com',
        domain: 'pdev2.corellium.com',
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
    let project = projects.filter(project => {
        return project.info.name === "Default Project";
    })[0];

    // Get the instances in the project.
    console.log('Getting instances...');
    let instances = await project.instances();

    let instance;
    if (instances.length === 0) {
        // If there's currently no instance, create one!

        // Get the firmware for iPhone 6 11.2.6.
        let firmware = 
            (await corellium.supported())
                .find({name: 'iPhone 6'})
                .find({version: '11.2.6'});

        // Create the instance.
        console.log('Creating new instance...');
        instance = await project.createInstance({
            'name': 'Test Device',
            'firmware': firmware,
            'patches': 'jailbroken'
        });

        // Wait for it to finish restoring.
        console.log('Waiting for device to finish restoring...');
        await instance.finishRestore();
    } else {
        // Use the first instance as our example.
        instance = instances[0];
    }

    console.log('Got instance: ' + instance.id);
    // The instance's console is accessible as a node stream and can be piped to stdout.
    //(await instance.console()).pipe(process.stdout);

    // Instances have the 'panic' event that can be listened for.
    instance.on('panic', async () => {
        console.log('Panic detected!');

        // If there's a panic, get the panic log.
        console.log(await instance.panics());

        // Download the console log.
        console.log(await instance.consoleLog());

        // Clear the panic log.
        await instance.clearPanics();

        // Reboot the instance.
        await instance.reboot();
    });

    instance.on('change', async () => {
        // You can listen for change events on instances. This also demonstrates publicly accessible properties on isntances.
        console.log(instance.id, instance.name, instance.state);
    });

    return;

    // If there's a freshly restored snapshot...
    console.log('Getting snapshots...');
    let snapshots = await instance.snapshots();
    let freshSnapshots = snapshots.filter(snapshot => snapshot.isFresh());
    if (freshSnapshots.length > 0) {
        // Restore to the freshly restored snapshot.
        console.log("Restoring to freshly restored snapshot...");
        await freshSnapshots[0].restore();
    }

    console.log("Taking new snapshot...");
    console.log('new snapshot', await instance.takeSnapshot('New snapshot'));
}

main().catch(err => {
    console.error(err);  
});
