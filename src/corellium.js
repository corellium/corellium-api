const {fetch, fetchApi, CorelliumError} = require('./util/fetch');
const Project = require('./project');
const SupportedDevices = require('./supported').SupportedDevices;

class Corellium {
    constructor(options) {
        this.options = options;
        this.api = options.endpoint + '/api/v1';
        this.token = null;
        this.supportedDevices = null;
    }

    async getToken() {
        if (this.token && this.token.expiration < new Date())
            return this.token;

        const res = await fetch(`${this.api}/tokens`, {
            method: 'POST',
            json: {
                username: this.options.username,
                password: this.options.password,
            },
        });
        this.token = {
            token: res.token,
            expiration: new Date(res.expiration),
        };
        return this.token.token;
    }

    async login() {
        await this.getToken();
    }

    async projects() {
        const projects = await fetchApi(this, '/projects');
        return await Promise.all(projects.map(project => this.getProject(project.id)));
    }

    async getProject(projectId) {
        const project = new Project(this, projectId);
        await project.refresh();
        return project;
    }

    async supported() {
        if (this.supportedDevices)
            return this.supportedDevices;

        let ipsws = await ipsw();
        return this.supportedDevices = new SupportedDevices(ipsws);
    }
}

module.exports = {
    Corellium,
    CorelliumError,
};
