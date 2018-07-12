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
        const token = await this.token;
        if (token && token.expiration > new Date())
            return token.token;

        this.token = (async () => {
            const unscopedToken = await this.client.getToken();
            const res = await fetch(`${this.api}/tokens`, {
                method: 'POST',
                token: unscopedToken,
                json: {
                    project: this.id
                },
            });
            return {
                token: res.token,
                expiration: new Date(res.expiration),
            };
        })();
        return (await this.token).token;
    }

    async instances() {
        const instances = await fetchApi(this, '/instances');
        return await Promise.all(instances.map(info => new Instance(this, info)));
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

    get quotas() {
        return this.info.quotas;
    }
    async quotasUsed() {
        const supported = await this.client.supported();
        let cpusUsed = 0;
        (await this.instances()).forEach(instance => {
            const device = supported.find(device => device.name === instance.flavor);
            cpusUsed += device.quotas.cpus;
        });
        return {cpus: cpusUsed};
    }

    get name() {
        return this.info.name;
    }
}

module.exports = Project;
