'use strict'

/**
 * Instances of this class are returned from {@link Corellium#teams).
 * They should not be created using the constructor.
 * @hideconstructor
 */
class Team {
  constructor (client, info) {
    this.client = client
    this.info = info
  }

  /** The ID of the team
     * @return {string}
     */
  get id () {
    return this.info.id
  }

  /** The users belonging to the team
     * @return {User[]}
     */
  get users () {
    return this.info.users.map((user) => this.client.getUser(user.id))
  }
}

module.exports = Team
