"use strict";

/**
 * Instances of this class are returned from {@link Corellium#users), and
 * {@link Team#users}. They should not be created using the constructor.
 * @hideconstructor
 */
class User {
  constructor(client, info) {
    this.client = client;
    this.info = info;
  }

  /** The ID of the user
   * @return {string}
   */
  get id() {
    return this.info.id;
  }

  /** The username of the user
   * @return {string}
   */
  get login() {
    return this.info.name;
  }

  /** The full name of the user
   * @return {string}
   */
  get name() {
    return this.info.label;
  }

  /** The email the user
   * @return {string}
   */
  get email() {
    return this.info.email;
  }

  /** Delete this user.
   *
   * This function is only available to domain administrators.
   */
  destroy() {
    this.client.destroyUser(this.info.id);
  }
}

module.exports = User;
