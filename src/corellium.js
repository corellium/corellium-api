const {fetch, fetchApi, CorelliumError} = require('./util/fetch');
const Project = require('./project');
const Team = require('./team');
const User = require('./user');
const Role = require('./role');
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
        this._teams = null;
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
     * Returns teams and users belonging to the domain.
     *
     * This function is only available to administrators.
     *
     * @returns {Promise<{ teams: Map<string, Team>, users: Map<string, User>}>}
     */
    async getTeamsAndUsers() {
        const teams = this._teams = new Map();
        for (const team of await fetchApi(this, '/teams')) {
            teams.set(team.id, new Team(this, team));
        }
        
        const users = this._users = new Map();
        for (const user of teams.get('all-users').info.users) {
            users.set(user.id, new User(this, user));
        }

        return {teams, users};
    }

    /**
     * Returns {@link Role}s belonging to the domain.
     *
     * This function is only available to domain and project administrators.
     */
    async roles() {
        const roles = this._roles = new Map();

        for (const role of await fetchApi(this, '/roles')) {
            let rolesForProject = roles.get(role.project);
            if (!rolesForProject) {
                rolesForProject = [];
                roles.set(role.project, rolesForProject);
            }
            rolesForProject.push(new Role(this, role));
        }
    }

    /**
     * Returns {@link Team}s belonging to the domain.
     *
     * This function is only available to domain and project administrators.
     */
    async teams() {
        return (await this.getTeamsAndUsers()).teams;
    }

    /**
     * Returns {@link User}s belonging to the domain.
     *
     * This function is only available to domain and project administrators.
     */
    async users() {
        return (await this.getTeamsAndUsers()).users;
    }

    /**
     * Given a user id, returns the {@link User}.
     *
     * This function is only available to domain and project administrators.
     *
     * @returns {Promise<User>}
     */
    getUser(id) {
        return this._users.get(id);
    }

    /**
     * Given a team id, returns the {@link Team}.
     *
     * This function is only available to domain and project administrators.
     */
    getTeam(id) {
        return this._teams.get(id);
    }

    /**
     * Creates a new user in the domain.
     *
     * This function is only available to domain administrators.
     */
    async createUser(login, name, email, password) {
        const response = await fetchApi(this, '/users', {
            method: 'POST',
            json: {
                label: name,
                name: login,
                email,
                password
            }
        });

        await this.getTeamsAndUsers();
        return this.getUser(response.id);
    }

    /**
     * Destroys a user in the domain.
     *
     * This function is only available to domain administrators.
     */
    async destroyUser(id) {
        await fetchApi(this, `/users/${id}`, {
            method: 'DELETE'
        });
    }

    /**
     * Creates a {@link Role} for a {@link Project} and a @{link Team} or @{link User}.
     */
    async createRole(project, grantee, type = 'user') {
        let usersOrTeams = grantee instanceof User && 'users';
        if (!usersOrTeams)
            usersOrTeams = grantee instanceof Team && 'teams';
        if (!usersOrTeams)
            throw 'Grantee not User or Team';

        await fetchApi(this, `/roles/projects/${project}/${usersOrTeams}/${grantee.id}/roles/{$type}`, {
            method: 'PUT'
        });
    }

    /**
     * Destroys a {@link Role}
     */
    async destroyRole(role) {
        let usersOrTeams = role.isUser ? 'users' : 'teams';
        await fetchApi(this, `/roles/projects/${role.project}/${usersOrTeams}/${role.grantee.id}/roles/{$role.type}`, {
            method: 'DELETE'
        });
    }

    /**
     * Returns the {@link Project} with the given ID.
     * @returns {Promise<Project>}
     */
    async getProject(projectId) {
        const project = new Project(this, projectId);
        await project.refresh();
        return project;
    }

    /**
     * Creates a {@link Project} with the given name {@link Color} and {@link ProjectSettings}.
     * @returns {Promise<Project>}
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
     * @returns {Promise<Project>}
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

    async projectKeys(project) {
        return await fetchApi(this, `/projects/${project}/keys`);
    }

    async addProjectKey(project, key, kind='ssh', label=null) {
        return await fetchApi(this, `/projects/${project}/keys`, {
            method: 'POST',
            json: {
                key, label, kind
            }
        });
    }

    async deleteProjectKey(project, keyId) {
        return await fetchApi(this, `/projects/${project}/keys/${keyId}`, {
            method: 'DELETE'
        });
    }
}

module.exports = {
    Corellium,
    CorelliumError,
    I,
};
