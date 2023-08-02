const { fetchApi } = require('./util/fetch')

/**
 * @typedef {object} WebPlayerFeatureSet
 * @property {boolean} files
 * @property {boolean} apps
 * @property {boolean} network
 * @property {boolean} coretrace
 * @property {boolean} messaging
 * @property {boolean} settings
 * @property {boolean} frida
 * @property {boolean} console
 * @property {boolean} portForwarding
 * @property {boolean} sensors
 * @property {boolean} snapshots
 */

/**
 * @typedef {object} WebPlayerSession
 * @property {string} projectId.required - The identifier of the project this session is tied to
 * @property {string} identifier - The identifier of this Web Player session
 * @property {string} instanceId - The identifier of the instance this session is tied to
 * @property {WebPlayerFeatureSet} features - Frontend feature set
 * @property {object} permissions - Endpoint permissions (optional)
 * @property {string?} token - The session's JWT
 * @property {string?} expiration - Session expiration in simplified extended ISO format ([ISO 8601]{@link https://en.wikipedia.org/wiki/ISO_8601})
 */

/**
 * @typedef {object} Response
 * @property {number} statusCode - [HTTP Status Code]{@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Status}
 * @property {object} result - JSON encoded error or empty object if successful
 */

/**
 * Instances of this class
 * are returned from {@link Instance#webplayer}. They should not be created using the constructor.
 * @hideconstructor
 */
class WebPlayer {
  constructor (project, instanceId, features, permissions) {
    this._onDestroy = () => {}
    this._project = project
    this._session = {
      features,
      permissions,
      projectId: project.id,
      instanceId,
      token: null,
      expiration: null,
      identifier: null
    }
  }

  static async _fetch (args) {
    const { project, sessionId = undefined, options = {} } = args
    const endpoint = sessionId ? `/webplayer/${sessionId}` : '/webplayer'
    return fetchApi(project, endpoint, options)
  }

  /**
   * Returns information about the Web Player session
   * @returns {WebPlayerSession}
   *
   * @example
   * let sessionInfo = webPlayerInst.info
   */
  get info () {
    return this._session
  }

  /**
   * Lists all active Web Player sessions
   * @param {object} project
   * @returns {Promise<Array<WebPlayerSession>>}
   *
   * @example
   * const sessions = webPlayerInst.sessions()
   * session.forEach(session => console.log(`${session.userId} session expires at ${session.expiration}`))
   */
  static async sessions (project) {
    return await WebPlayer._fetch({
      project,
      options: { method: 'GET' }
    })
  }

  /**
   * Updates and returns information about the Web Player session
   * @returns {Promise<WebPlayerSession>}
   *
   * @example
   * let sessionInfo = webPlayerInst.refreshSession()
   */
  async refreshSession () {
    const sessionId = this._session.identifier
    if (sessionId) {
      // TODO: What happens if the record is gone? Auto destroy self?
      const result = await WebPlayer._fetch({
        project: this._project,
        sessionId,
        options: { method: 'GET' }
      })
      if (Array.isArray(result) && result[0]) {
        // Update local data
        this._session = Object.assign(this._session, result[0])
      } else {
        console.warn(`WebPlayer session ${sessionId} not found`)
      }
    }
    return this._session
  }

  /*
   * Create a Web Player session
   * @param {number} expiresIn - Number of seconds until the token expires
   * @param {function} onDestroy - Callback when destroyed
   * @returns {Promise<WebPlayerSession>}
   *
   * @example
   * // Create a session token with a 10-minute expiration
   * let wpSession = await webPlayerInst.sessionToken(600)
   */
  async _createSession (expiresIn, onDestroy) {
    const newSession = await WebPlayer._fetch({
      project: this._project,
      options: {
        method: 'POST',
        json: {
          projectId: this._session.projectId,
          instanceId: this._session.instanceId,
          features: this._session.features,
          permissions: this._session.permissions ? this._session.permissions : null,
          expiresIn
        }
      }
    })
    this._onDestroy = onDestroy
    this._session = Object.assign(this._session, newSession)
    return this._session
  }

  /**
   * Destroy the Web Player session
   * @param {string} session
   * @returns {Promise<Response>}
   *
   * @example
   * await webPlayerInst.destroySession()
   */
  async destroy (session) {
    const onDestroy = this._onDestroy
    const sessionId = session || this._session.identifier
    this._session.identifier = null
    this._session.token = null
    this._session.expiration = null
    this._onDestroy = null
    const result = await WebPlayer._fetch({
      project: this._project,
      sessionId,
      options: { method: 'DELETE' }
    })
    if (typeof onDestroy === 'function') {
      onDestroy()
    }
    return result
  }
}

module.exports = WebPlayer
