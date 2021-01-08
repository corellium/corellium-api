/**
 * An instance snapshot.
 *
 * Instances of this class are returned from {@link Instance#snapshots} and {@link Instance#takeSnapshot}. They
 * should not be created using the constructor.
 * @hideconstructor
 */
class Snapshot {
  constructor(instance, snap) {
    this.instance = instance;
    this.receiveUpdate(snap);
  }

  async update() {
    this.receiveUpdate(await this._fetch(""));
  }

  receiveUpdate(snap) {
    this.id = snap.id;
    this.name = snap.name;
    this.status = snap.status;
    this.created = new Date(snap.created);
    this.fresh = snap.fresh;
  }

  /**
   * Rename this snapshot.
   * @param {string} name - The new name for the snapshot.
   * @example
   * const snapshots = await instance.snapshots();
   * const snapshot = snapshots.find(snapshot => snapshot.name === 'Test 1');
   * if (snapshot) {
   *     await snapshot.rename('Test 1 new');
   * }
   */
  async rename(name) {
    await this._fetch("", { method: "PATCH", json: { name } });
  }

  /**
   * Restore the instance to this snapshot.
   * @example
   * const snapshots = await instance.snapshots();
   * const snapshot = snapshots.find(snapshot => snapshot.name === 'Pre-Test 1');
   * if (snapshot) {
   *     await snapshot.restore();
   * }
   */
  async restore() {
    await this._fetch(`/restore`, { method: "POST" });
  }

  /**
   * Delete this snapshot.
   * @example
   * const snapshots = await instance.snapshots();
   * snapshots.forEach(snapshot => {
   *     console.log("Deleting snapshot " + snapshot.name)
   *     snapshot.delete();
   * });
   */
  async delete() {
    await this._fetch("", { method: "DELETE" });
  }

  async _fetch(endpoint, options) {
    return await this.instance._fetch(
      `/snapshots/${this.id}${endpoint}`,
      options
    );
  }
}

module.exports = Snapshot;
