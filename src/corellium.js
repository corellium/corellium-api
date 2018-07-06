const {fetch, fetchApi, CorelliumError} = require('./util/fetch');
const Project = require('./project');
const {I} = require('./input');

class Corellium {
    constructor(options) {
        this.options = options;
        this.api = options.endpoint + '/api/v1';
        this.token = null;
        this.supportedDevices = null;
    }

    async getToken() {
        const token = await this.token;
        if (token && token.expiration > new Date())
            return token.token;

        this.token = (async () => {
            const res = await fetch(`${this.api}/tokens`, {
                method: 'POST',
                json: {
                    username: this.options.username,
                    password: this.options.password,
                },
            });
            return {
                token: res.token,
                expiration: new Date(res.expiration),
            };
        })();
        return (await this.token).token;
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

    async projectNamed(name) {
        const projects = await this.projects();
        return projects.find(project => project.name === name);
    }

    async supported() {
        if (!this.supportedDevices)
            this.supportedDevices = await fetchApi(this, '/supported');
        return this.supportedDevices;
    }
}

module.exports = {
    Corellium,
    CorelliumError,
    I,
};
