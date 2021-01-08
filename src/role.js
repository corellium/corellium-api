/**
 * Instances of this class are returned from {@link Corellium#roles}.
 * They should not be created using the constructor.
 * @hideconstructor
 */
class Role {
  constructor(client, info) {
    this.client = client;
    this.info = info;
  }

  /** The project name for which the role grants permissions.
   *
   * @return {string}
   */
  get project() {
    return this.info.name;
  }

  /** The type of permissions granted. Either admin or user.
   *
   * @return {string}
   */
  get type() {
    return this.info.label;
  }

  /** The object getting the permissions. Either a user or a team.
   *
   * @return {Promise<User>}
   * @return {Promise<Team>}
   */
  get grantee() {
    if (this.info.user) return this.client.getUser(this.info.user);

    if (this.info.team) return this.client.getTeam(this.info.team);
  }

  /** Is the object getting the permissions a user?
   *
   * @return {boolean}
   */
  get isUser() {
    return !!this.info.user;
  }

  /** Is the object getting the permissions a team?
   *
   * @return {boolean}
   */
  get isTeam() {
    return !!this.info.team;
  }

  /** Deletes the role */
  async destroy() {
    await this.client.destroyRole(this);
  }
}

module.exports = Role;
