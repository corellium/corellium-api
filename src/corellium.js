const {fetch, fetchApi, CorelliumError} = require('./util/fetch');
const Project = require('./project');
const {I} = require('./input');

/**
 * The Corellium API client.
 */
class Corellium {
    /**
     * Create a new Corellium client.
     * @param {Object} options
     * @param {string} options.endpoint - Endpoint URL
     * @param {string} options.username - Login username
     * @param {string} options.password - Login password
     * @example
     * const corellium = new Corellium({
     *     endpoint: 'https://demo.corellium.com',
     *     username: 'admin',
     *     password: 'password',
     * });
     */
    constructor(options) {
        this.options = options;
        this.api = options.endpoint + '/api/v1';
        this.token = null;
        this.supportedDevices = null;
    }

    async getToken() {
        const token = await this.token;

        // If the token is more than 15 minutes from expiring, we don't need to refresh it.
        if (token && token.expiration > new Date((new Date()).getTime() + 15 * 60 * 1000))
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

    /**
     * Logs into the Corellium API and obtains an authentication token. Does
     * nothing if the current authentication token is up to date.
     *
     * Calling this method is not required, as calling any other method that
     * needs an authentication token will do the same thing.
     */
    async login() {
        await this.getToken();
    }

    /**
     * Returns an array of {@link Project}s that this client is allowed to
     * access.
     * @returns {Project[]}
     */
    async projects() {
        const projects = await fetchApi(this, '/projects?ids_only=1');
        return await Promise.all(projects.map(project => this.getProject(project.id)));
    }

    /**
     * Returns the {@link Project} with the given ID.
     * @returns {Project}
     */
    async getProject(projectId) {
        const project = new Project(this, projectId);
        await project.refresh();
        return project;
    }

    /**
     * Creates a {@link Project} with the given name {@link Color} and {@link ProjectSettings}.
     * @returns {Project}
     */
    async createProject(name, color = 1, settings = {version: 1, 'internet-access': true}) {
        const response = await fetchApi(this, '/projects', {
            method: 'POST',
            json: {
                name,
                color,
                settings
            }
        });

        return await this.getProject(response.id);
    }

    /**
     * Returns the {@link Project} with the given name. If the project doesn't
     * exist, returns undefined.
     * @returns {Project}
     */
    async projectNamed(name) {
        const projects = await this.projects();
        return projects.find(project => project.name === name);
    }

    /** @todo document this */
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
