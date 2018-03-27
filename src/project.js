const {fetch, fetchApi} = require('./util/fetch');
const Instance = require('./instance');

class Project {
    constructor(client, id) {
        this.client = client;
        this.api = this.client.api;
        this.id = id;
        this.token = null;
    }

    async refresh() {
        this.info = await fetchApi(this, `/projects/${this.id}`);
    }

    async getToken() {
        if (this.token && this.token.expiration < new Date())
            return this.token.token;

        const unscopedToken = await this.client.getToken();
        const res = await fetch(`${this.api}/tokens`, {
            method: 'POST',
            token: unscopedToken,
            json: {
                project: this.id
            },
        });
        this.token = {
            token: res.token,
            expiration: new Date(res.expiration),
        };
        return this.token.token;
    }

    async instances() {
        const instances = await fetchApi(this, '/instances');
        return await Promise.all(instances.map(instance => this.getInstance(instance.id)));
    }

    async getInstance(id) {
        const info = await fetchApi(this, `/instances/${id}`);
        return new Instance(this, info);
    }

    async createInstance(options) {
        const {id} = await fetchApi(this, '/instances', {
            method: 'POST',
            json: options,
        });
        return await this.getInstance(id);
    }
}

module.exports = Project;
