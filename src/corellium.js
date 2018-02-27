const openstack = require('openstack-api');
const Project = require('./project');
const ipsw = require('./util/ipsw');
const SupportedDevices = require('./supported').SupportedDevices;

class Corellium {
    constructor(options) {
        this.options = options;
        this.initialized = false;
        this.tokens = null;
        this.supportedDevices = null;
    }

    async initialize() {
        if (this.initialized)
            return;

        await openstack.helpers.initialize_catalog();
        this.initialized = true;
    }

    async login(force = false) {
        await this.initialize();
        if (!force && this.tokens && new Date(this.tokens.domain.expiration) > new Date())
            return;

        let tokens = await openstack.identity.login_all_projects(this.options.domain, this.options.username, this.options.password);
        this.tokens = tokens;
    }

    async projectToken(projectId) {
        await this.login();
        if (this.tokens.projects[projectId])
            return this.tokens.projects[projectId];

        await this.login(true);
        return this.tokens.projects[projectId];
    }

    async projects() {
        await this.login();
        let projectIds = await openstack.identity.projects(this.tokens.domain.token);
        let missingLoginTokens = projectIds.some(id => {
            if (!this.tokens.projects[id])
                return true;
            return false;
        });

        if (missingLoginTokens)
            await this.login(true);

        let projectInfo = await Promise.all(Object.keys(this.tokens.projects).map(id => {
            let projectToken = this.tokens.projects[id];
            return openstack.identity.projects_info(projectToken.token, id);
        }));

        return projectInfo.map(info => {
            return new Project(this, info);
        });
    }

    async supported() {
        if (this.supportedDevices)
            return this.supportedDevices;

        let ipsws = await ipsw();
        return this.supportedDevices = new SupportedDevices(ipsws);
    }
}

module.exports = {
    Corellium: Corellium
};
