Before using this, /etc/corellium/config.json must exist and be pointed to the right endpoint.
A config.json configured for pdev2 is included in example/config.json

index.js here is some example code. It should also be possible to do:

mkdir new-project
cd new-project
npm init
npm install --save git+ssh://gitolite3@dev.corellium.com:8002/corellium-api

And then make an index.js in that folder with the following code:

const Corellium = require('corellium-api').Corellium;

let corellium = new Corellium({
    domain: 'pdev2',
    username: 'adam', 
    password: 'c0rellium1'
});

...

This will make an independent project that doesn't include the actual API source code but can use it as a library.
