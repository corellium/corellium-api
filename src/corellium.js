'use strict'

const { fetch, fetchApi, CorelliumError } = require('./util/fetch')
const Project = require('./project')
const Team = require('./team')
const User = require('./user')
const Role = require('./role')
const WebPlayer = require('./webplayer')
const { I } = require('./input')
const { listImagesMetaData } = require('./images')

/**
 * @typedef {object} SupportedDevice
 * @property {string} type
 * @property {string} name
 * @property {string} flavor
 * @property {string} description
 * @property {string} model
 * @property {Object} firmwares
 * @property {string} firmwares.version
 * @property {string} firmwares.buildid
 * @property {string} firmwares.sha256sum
 * @property {string} firmwares.sha1sum
 * @property {string} firmwares.md5sum
 * @property {integer} firmwares.size
 * @property {string} firmwares.uniqueid
 * @property {string} firmwares.metadata
 * @property {string} firmwares.releasedate - ISO datetime string
 * @property {string} firmwares.uploaddate - ISO datetime string
 * @property {string} firmwares.url
 * @property {string} firmwares.orig_url
 * @property {string} firmwares.filename
 * @property {Object} quotas
 * @property {integer} quotas.cores
 * @property {integer} quotas.cpus
 */

/**
 * The Corellium API client.
 */
class Corellium {
  /**
   * Create a new Corellium client.
   * @constructor
   * @param {Object} options
   * @param {string} options.endpoint - Endpoint URL
   * @param {string?} options.apiToken - Login apiToken
   * @param {string?} options.username - Login username
   * @param {string?} options.password - Login password
   * @param {string?} options.totpToken - Login TOTP (Timebased One Time Password)
   * @example
   * const corellium = new Corellium({
   *     endpoint: 'https://app.corellium.com',
   *     username: 'username',
   *     password: 'password',
   *     totpToken: '123456',
   * });
   */
  constructor(options) {
    this.options = options
    this.api = options.endpoint + '/api/v1'
    this.token = null
    this.supportedDevices = null
    this._teams = null
  }

  /**
   * Returns refreshed authentication token
   * @return {string} token
   * @example
   * let token = await corellium.getToken()
   */
  async getToken() {
    const token = this.options.token || (await this.token)
    const maxExpiration = new Date(new Date().getTime() + 15 * 60 * 1000)

    // If the token is more than 15 minutes from expiring, we don't need to refresh it.
    if (token) {
      const expiration =
        typeof token.expiration === 'string' ? Date.parse(token.expiration) : token.expiration
      if (expiration > maxExpiration) {
        return token.token
      }
    }

    const postData = {}
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      json: postData
    }
    if (this.options.apiToken) {
      postData.apiToken = this.options.apiToken
    } else if (this.options.username && this.options.password) {
      postData.username = this.options.username
      postData.password = this.options.password
      if (this.options.totpToken) {
        postData.totpToken = this.options.totpToken
      }
    } else if (token) {
      // renew using current token
      fetchOptions.headers.Authorization = token.token
    }

    this.token = (async () => {
      const res = await fetch(`${this.api}/tokens`, fetchOptions)
      return {
        token: res.token,
        expiration: new Date(res.expiration)
      }
    })()
    return (await this.token).token
  }

  /**
   * Generate an API token to be used with the API. This is
   * non-recoverable, so if it is lost, you must generate a new one.
   *
   * This can be used to for the login method by passing it as the apiToken
   *
   * @returns {string} apiToken
   */
  async generateApiToken() {
    const response = await fetchApi(this, '/apitoken', {
      method: 'POST'
    })

    return response
  }

  /**
   * Remove the currently active api token from this user account.
   */
  async removeApiToken() {
    await fetchApi(this, '/apitoken', {
      method: 'DELETE'
    })
  }

  /**
   * Logs into the Corellium API and obtains an authentication token. Does
   * nothing if the current authentication token is up to date.
   *
   * Calling this method is not required, as calling any other method that
   * needs an authentication token will do the same thing.
   * @example
   * await corellium.login();
   */
  async login() {
    await this.getToken()
  }

  /**
   * Returns an array of {@link Project}s that this client is allowed to
   * access.
   * @returns {Project[]}
   * @example
   * let projects = await corellium.projects();
   * let project = projects.find(project => project.name === "Demo Project");
   */
  async projects() {
    const projects = await fetchApi(this, '/projects?ids_only=1')
    return await Promise.all(projects.map(project => this.getProject(project.id)))
  }

  /**
   * Returns an array of {@link Image}s that this client is allowed to
   * access.
   * @returns {Promise<Image[]>}
   * @example
   * let images = await corellium.files();
   */
  files() {
    return listImagesMetaData(this)
  }

  /**
   * Returns teams and users belonging to the domain.
   *
   * This function is only available to administrators.
   *
   * @returns {Promise<{ teams: Map<string, Team>, users: Map<string, User>}>}
   * @example
   * let teamsAndUsers = await corellium.getTeamsAndUsers();
   */
  async getTeamsAndUsers() {
    const teams = (this._teams = new Map())
    for (const team of await fetchApi(this, '/teams')) {
      teams.set(team.id, new Team(this, team))
    }

    const users = (this._users = new Map())
    for (const user of teams.get('all-users').info.users) {
      users.set(user.id, new User(this, user))
    }

    return { teams, users }
  }

  /**
   * Returns {@link Role}s belonging to the domain.
   *
   * This function is only available to domain and project administrators.
   * @return {Promise<Map<string, Role[]>>}
   * @example
   * let roles = await corellium.roles();
   */
  async roles() {
    const roles = (this._roles = new Map())

    for (const role of await fetchApi(this, '/roles')) {
      let rolesForProject = roles.get(role.project)
      if (!rolesForProject) {
        rolesForProject = []
        roles.set(role.project, rolesForProject)
      }
      rolesForProject.push(new Role(this, role))
    }

    return roles
  }

  /**
   * Returns {@link Team}s belonging to the domain.
   *
   * This function is only available to domain and project administrators.
   * @return {Promise<Map<string, Team>>}
   * @example
   * let teams = await corellium.teams();
   */
  async teams() {
    return (await this.getTeamsAndUsers()).teams
  }

  /**
   * Returns {@link User}s belonging to the domain.
   *
   * This function is only available to domain and project administrators.
   * @return {Promise<Map<string, User>>}
   * @example
   * let users = await corellium.users();
   */
  async users() {
    return (await this.getTeamsAndUsers()).users
  }

  /**
   * Given a user id, returns the {@link User}.
   *
   * This function is only available to domain and project administrators.
   * @returns {Promise<User>}
   * @example
   * let user = await instance.getUser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
   */
  getUser(id) {
    return this._users.get(id)
  }

  /**
   * Given a team id, returns the {@link Team}.
   *
   * This function is only available to domain and project administrators.
   * @returns {Promise<Team>}
   * @example
   * let team = await instance.getTeam('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
   */
  getTeam(id) {
    return this._teams.get(id)
  }

  /**
   * Creates a new user in the domain.
   *
   * This function is only available to domain administrators.
   * @returns {Promise<User>}
   * @example
   * let user = await instance.createUser("login", "User Name", "user@email.com", "password");
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
    })

    await this.getTeamsAndUsers()
    return this.getUser(response.id)
  }

  /**
   * Destroys a user in the domain.
   *
   * This function is only available to domain administrators.
   * @param {string} id - user ID
   * @example
   * instance.destroyUser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
   */
  async destroyUser(id) {
    await fetchApi(this, `/users/${id}`, {
      method: 'DELETE'
    })
  }

  /**
   * Creates a {@link Role} for a {@link Project} and a {@link Team} or {@link User}.
   * @param {string} project - project ID
   * @param {User|Team} grantee - must be an instance of {@link User} or {@link Team}
   * @param {string} type - user ID
   * @example
   * instance.createRole(project.id, grantee, 'user');
   */
  async createRole(project, grantee, type = 'user') {
    let usersOrTeams = grantee instanceof User && 'users'
    if (!usersOrTeams) {
      usersOrTeams = grantee instanceof Team && 'teams'
    }
    if (!usersOrTeams) {
      throw 'Grantee not User or Team'
    }

    await fetchApi(this, `/roles/projects/${project}/${usersOrTeams}/${grantee.id}/roles/${type}`, {
      method: 'PUT'
    })
  }

  /**
   * Destroys a {@link Role}
   * @param {Role} role - role object
   * @example
   * instance.destroyRole(role);
   */
  async destroyRole(role) {
    let usersOrTeams = role.isUser ? 'users' : 'teams'
    await fetchApi(
      this,
      `/roles/projects/${role.project}/${usersOrTeams}/${role.grantee.id}/roles/{$role.type}`,
      {
        method: 'DELETE'
      }
    )
  }

  /**
   * Returns the {@link Project} with the given ID.
   * @param {string} projectId - project ID
   * @returns {Promise<Project>}
   * @example
   * let project = await corellium.getProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
   */
  async getProject(projectId) {
    const project = new Project(this, projectId)
    await project.refresh()
    return project
  }

  /**
   * Creates a {@link Project} with the given name {@link Color} and {@link ProjectSettings}.
   * @param {string} name - project name
   * @param {integer} color - color
   * @param {Object} [settings] - project settings
   * @param {integer} settings.version
   * @param {boolean} settings.internet-access
   * @returns {Promise<Project>}
   * @example
   * corellium.createProject("TestProject");
   */
  async createProject(name, color = 1, settings = { version: 1, 'internet-access': true }) {
    const response = await fetchApi(this, '/projects', {
      method: 'POST',
      json: {
        name,
        color,
        settings
      }
    })

    return await this.getProject(response.id)
  }

  /**
   * Returns the {@link Project} with the given name. If the project doesn't
   * exist, returns undefined.
   * @param {string} name - project name to match
   * @returns {Promise<Project>}
   * @example
   * let project = await corellium.projectNamed('Default Project');
   */
  async projectNamed(name) {
    const projects = await this.projects()
    return projects.find(project => project.name === name)
  }

  /** Returns supported device list
   * @return {SupportedDevice[]}
   * @example
   * let supported = await corellium.supported();
   */
  async supported() {
    if (!this.supportedDevices) {
      this.supportedDevices = await fetchApi(this, '/supported')
    }
    return this.supportedDevices
  }

  /** Returns all keys for the project
   * @param {string} project - project ID
   * @return {ProjectKey[]}
   * @example
   * let keys = instance.projectKeys(project.id);
   * for(let key of keys)
   *   console.log(key);
   */
  async projectKeys(project) {
    return await fetchApi(this, `/projects/${project}/keys`)
  }

  /** Adds key to the project
   * @param {string} project - project ID
   * @param {string} key - public key
   * @param {string} kind - key type ('ssh'/'abd')
   * @param {string} [label] - key label
   * @return {string} key ID
   * @example
   * let project = instance.getProjectNamed('TestProject');
   * instance.addProjectKey(project.id, key, 'ssh', 'SSH Key');
   */
  async addProjectKey(project, key, kind = 'ssh', label = null) {
    return await fetchApi(this, `/projects/${project}/keys`, {
      method: 'POST',
      json: {
        key,
        label,
        kind
      }
    })
  }

  /** Adds key to the project
   * @param {string} project - project ID
   * @param {string} keyId - key ID
   * @example
   * let project = instance.getProjectNamed('TestProject');
   * instance.deleteProjectKey(project.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
   */
  async deleteProjectKey(project, keyId) {
    return await fetchApi(this, `/projects/${project}/keys/${keyId}`, {
      method: 'DELETE'
    })
  }
}

module.exports = {
  Corellium,
  CorelliumError,
  I,
  WebPlayer
}
