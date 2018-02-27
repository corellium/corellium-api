const openstack = require('openstack-api');
const crypto = require('crypto');
const key = require('./util/key');
const compat = require('./util/compat');
const Instance = require('./instance');

class Project {
    constructor(account, info) {
        this.account = account;
        this.info = info;
    }

    id() {
        return this.info.id;
    }

    name() {
        return this.info.name;
    }

    async token() {
        return this.account.projectToken(this.id());
    }

    async instances() {
        let projectToken = await this.token();
        let instanceInfos = await openstack.compute.instances_for_token(projectToken.token);
        return instanceInfos.map(([info, metadata])=> {
            return new Instance(this.account, this, info, metadata);
        });
    }

    async routerInfo() {
        return key.decryptRouterInfo(this.info.router_key, Buffer.from(this.info.router, 'base64'));
    }

    async createInstance(options) {
        let projectToken = await this.token();

        if (!options.ipsw || !options.flavor) {
            let firmware = options.firmware;
            options = Object.assign({}, options, {
                flavor: firmware.device.info.flavorId,
                ipsw: firmware.info.url,
                ipsw_sha1: firmware.info.sha1sum,
                ipsw_md5: firmware.info.md5sum,
                os: firmware.info.version
            });
        }

        if (!options.key) {
            options = Object.assign({}, options, {
                key: crypto.randomBytes(64).toString('hex')
            });
        }

        if (!options.router) {
            options = Object.assign({}, options, {
                router: JSON.stringify(await this.routerInfo())
            });
        }

        if (!options.bootOptions) {
            options = Object.assign({}, options, {
                bootOptions: {}
            });
        }

        if (!options.bootOptions.udid) {
            options = Object.assign({}, options, {
                bootOptions: Object.assign({}, options.bootOptions, {
                    udid: crypto.randomBytes(20).toString('hex')
                })
            });
        }

        if (!options.bootOptions.ecid) {
            options = Object.assign({}, options, {
                bootOptions: Object.assign({}, options.bootOptions, {
                    ecid: crypto.randomBytes(8).toString('hex')
                })
            });
        }

        options = Object.assign({}, options, {
            token: projectToken,
            project: this.id()
        });

        let instanceId = await compat.createInstance(options);
        let [instanceInfo, metadata] = await openstack.compute.instance(projectToken.token, instanceId);
        return new Instance(this.account, this, instanceInfo, metadata); 
    }
}

module.exports = Project;
