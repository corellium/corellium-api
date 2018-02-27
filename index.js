const Corellium = require('./src/corellium').Corellium;

async function main() {
    // Configure the API.
    let corellium = new Corellium({
        domain: 'pdev2',
        username: 'adam',
        password: 'c0rellium1'
    });

    // Login.
    await corellium.login();

    // Get the list of projects.
    let projects = await corellium.projects();

    // Find the project called "David's Project".
    let project = projects.filter(project => {
        return project.info.name === "David's Project";
    })[0];

    // Get the instances in the project.
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
        instance = await project.createInstance({
            'name': 'Test Device',
            'firmware': firmware,
            'patches': 'jailbroken'
        });

        // Wait for it to finish restoring.
        await instance.finishRestore();
    } else {
        // Use the first instance as our example.
        instance = instances[0];
    }

    // The instance's console is accessible as a node stream and can be piped to stdout.
    (await instance.console()).pipe(process.stdout);

    // Instances have the 'panic' event that can be listened for.
    instance.on('panic', async () => {
        // If there's a panic, get the panic log.
        console.log(await instance.panics());

        // Clear the panic log.
        await instance.clearPanics();

        // Reboot the instance.
        await instance.reboot();
    });

    instance.on('change', async () => {
        // You can listen for change events on instances. This also demonstrates publicly accessible properties on isntances.
        console.log(instance.id(), instance.name(), instance.status());
    });
}

main().catch(err => {
    console.error(err);  
});
