const uuidv1 = require('uuid/v1');
const supportedDevices = require('./supporteddevices');
const openstack = require('openstack-api');
const identity = openstack.identity;
const compute = openstack.compute;
const volume = openstack.volume;
const helpers = openstack.helpers;
const exceptions = openstack.exceptions;
const image = openstack.image;

async function createInstance(options) {
    let token = options['token'];
    let project = options['project'];
    let flavor = options['flavor'];
    let name = options['name'];
    let os = options['os'];
    let patches = options['patches'];
    let ipsw = options['ipsw'];
    let ipsw_sha1 = options['ipsw_sha1'];
    let ipsw_md5 = options['ipsw_md5'];
    let node = options['node'];
    let encrypt = options['encrypt'];
    let key = options['key'];
    let router = options['router'];
    let snapshot = options['snapshot'];
    let bootOptions = options['bootOptions'];
    let metadata = {
        'patches': patches,
        'ipsw': ipsw,
        'ipsw_sha1': ipsw_sha1,
        'ipsw_md5': ipsw_md5,
        'os': os,
        'encrypt': encrypt ? "true" : "false",
        'key': key,
        'router': router,
        'proxy': JSON.stringify([
            {
                'devicePort': 22,
                'routerPort': 2222,
                'firstAvailable': true
            },
            {
                'devicePort': 33,
                'routerPort': 33,
                'firstAvailable': true,
                'expose': true
            }
        ])
    };

    if (bootOptions) {
        if (bootOptions.kernel) {
            metadata = Object.assign(metadata, {
                'kernel': bootOptions.kernel.id,
                'kernel-filename': bootOptions.kernel.name
            });
        }
        
        if (bootOptions.ramdisk) {
            metadata = Object.assign(metadata, {
                'ramdisk': bootOptions.ramdisk.id,
                'ramdisk-filename': bootOptions.ramdisk.name
            });
        }
        
        if (bootOptions.devicetree) {
            metadata = Object.assign(metadata, {
                'devicetree': bootOptions.devicetree.id,
                'devicetree-filename': bootOptions.devicetree.name
            });
        }

        if (bootOptions['restore-boot-args']) {
            metadata = Object.assign(metadata, {
                'restore-boot-args': bootOptions['restore-boot-args']
            });
        }

        if (bootOptions['boot-args']) {
            metadata = Object.assign(metadata, {
                'boot-args': bootOptions['boot-args']
            });
        }

        if (bootOptions['kernel-patches']) {
            metadata = Object.assign(metadata, {
                'kernel-patches': bootOptions['kernel-patches']
            });
        }

        if (bootOptions['random-seed']) {
            metadata = Object.assign(metadata, {
                'random-seed': bootOptions['random-seed']
            });
        }

        if (bootOptions['udid']) {
            metadata = Object.assign(metadata, {
                'udid': bootOptions['udid']
            });
        }

        if (bootOptions['ecid']) {
            metadata = Object.assign(metadata, {
                'ecid': bootOptions['ecid']
            });
        }

        if (bootOptions['cdhashes']) {
            metadata = Object.assign(metadata, {
                'cdhashes': JSON.stringify(bootOptions['cdhashes'])
            });
        }
    }

    if (snapshot)
        metadata['is-restore'] = '2';
    else
        metadata['is-restore'] = '1';

    if (name) {
        metadata['name_changed'] = '1';
    } else {
        name = uuidv1();
    }

    let newDevice;
    supportedDevices.devices.some(device => {
        if(flavor === device['flavorId']) {
            newDevice = device;
            return true;
        }
        return false
    })[0];

    metadata['device'] = JSON.stringify(newDevice);

    let projectInfo = await identity.projects_info(token.token, project);
    let az = projectInfo['az'];
    let storage_az = projectInfo['storage_az'];

    return Promise.all([
        helpers.ensure_correct_security_group_for_project(token.token, project),
        identity.project_scoped(token.token, project)   // Get a fresh token to try to maximize the chance that we still have permissions after the restore to take a snapshot. 
    ]).then(([, newToken]) => {
        let volumeOptions;
        if (snapshot) {
            volumeOptions = {
                snapshot: snapshot
            };
        } else {
            volumeOptions = {
                newVolume: newDevice['volume']['allocate']
            };
        }

        return compute.instanceCreate(newToken.token, az, name, flavor, metadata, node, volumeOptions).then(instance => {
            compute.instanceWaitForVolumes(newToken.token, instance).then(volumes => {
                return Promise.all(volumes.map(volumeId => {
                    return volume.volumeSetBootable(newToken.token, project, volumeId, true);
                })).then(ret => {
                    return instance;
                });
            });
            return instance;
        });
    });
}

module.exports = {
    createInstance: createInstance
};
