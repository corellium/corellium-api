const {fetch, fetchApi} = require('./util/fetch');
const Instance = require('./instance');
const InstanceUpdater = require('./instance-updater');
const uuidv4 = require('uuid/v4');

/**
 * Instances of this class are returned from {@link Corellium#projects}, {@link
 * Corellium#getProject}, and {@link Corellium#projectNamed}. They should not
 * be created using the constructor.
 * @hideconstructor
 */
class Project {
    constructor(client, id) {
        this.client = client;
        this.api = this.client.api;
        this.id = id;
        this.token = null;
        this.updater = new InstanceUpdater(this);
    }

    /**
     * Reload the project info. This currently consists of name and quotas, but
     * will likely include more in the future.
     */
    async refresh() {
        this.info = await fetchApi(this, `/projects/${this.id}`);
    }

    async getToken() {
        const token = await this.token;
        
        // If the token is more than 15 minutes from expiring, we don't need to refresh it.
        if (token && token.expiration > new Date((new Date()).getTime() + 15 * 60 * 1000))
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

    /**
     * Returns an array of the {@link Instance}s in this project.
     * @returns {Instance[]} The instances in this project
     * @example <caption>Finding the first instance with a given name</caption>
     * const instances = await project.instances();
     * const instance = instances.find(instance => instance.name === 'Test Device');
     */
    async instances() {
        const instances = await fetchApi(this, '/instances');
        return await Promise.all(instances.map(info => new Instance(this, info)));
    }

    /**
     * Returns the {@link Instance} with the given ID.
     * @returns {Instance}
     * @param {string} id
     */
    async getInstance(id) {
        const info = await fetchApi(this, `/instances/${id}`);
        return new Instance(this, info);
    }

    /**
     * Creates an instance and returns the {@link Instance} object. The options
     * are passed directly to the API.
     *
     * @param {Object} options - The options for instance creation. These are
     * the same as the JSON options passed to the instance creation API
     * endpoint. For a full list of possible options, see the API documentation.
     * @param {string} options.flavor - The device flavor, such as `iphone6`
     * @param {string} options.os - The device operating system version
     * @param {string} [options.name] - The device name
     * @param {string|string[]} [options.patches] - Instance patches, such as `jailbroken` (default)
     * @returns {Instance}
     *
     * @example <caption>Creating an instance and waiting for it to start its first boot</caption>
     * const instance = await project.createInstance({
     *     flavor: 'iphone6',
     *     os: '11.3',
     *     name: 'Test Device',
     * });
     * await instance.finishRestore();
     */
    async createInstance(options) {
        const {id} = await fetchApi(this, '/instances', {
            method: 'POST',
            json: options,
        });
        return await this.getInstance(id);
    }

    /**
     * Get the VPN configuration to connect to the project network. This is only
     * available for cloud. At least one instance must be on in the project.
     *
     * @param {string} type -       Could be either "ovpn" or "tblk" to select between OpenVPN and TunnelBlick configuration formats.
     *                              TunnelBlick files are delivered as a ZIP file and OpenVPN configuration is just a text file.
     * @param {string} clientUUID - An arbitrary UUID to uniquely associate this VPN configuration with so it can be later identified
     *                              in a list of connected clients. Optional.
     * @returns {Buffer}
     */
    async vpnConfig(type = 'ovpn', clientUUID) {
        if (!clientUUID)
            clientUUID = uuidv4();

        const response = await fetchApi(this, `/projects/${this.id}/vpn-configs/${clientUUID}.${type}`, {response: 'raw'});
        return await response.buffer();
    }

    /** Destroy this project. */
    async destroy() {
        return await fetchApi(this, `/projects/${this.id}`, {
            method: 'DELETE'
        });
    }

    /**
     * The project quotas.
     * @property {number} cores - Number of avilable CPU cores
     */
    get quotas() {
        return this.info.quotas;
    }

    set quotas(quotas) {
        setQuotas(quotas)
    }

    /**
     * Sets the project quotas. Only the cores property is currently respected.
     */
    async setQuotas(quotas) {
        this.info.quotas = Object.assign({}, this.info.quotas, quotas);
        await fetchApi(this, `/projects/${this.id}`, {
            method: 'PATCH',
            json: {
                quotas: {
                    cores: quotas.cores || quotas.cpus
                }
            }
        });
    }

    /**
     * How much of the project's quotas are currently used. To ensure this information is up to date, call {@link Project#refresh()} first.
     * @property {number} cores - Number of used CPU cores
     */
    get quotasUsed() {
        return this.info.quotasUsed;
    }

    /** The project's name. */
    get name() {
        return this.info.name;
    }
}

module.exports = Project;
