class Snapshot {
    constructor(instance, snap) {
        this.instance = instance;
        this.id = snap.id;
        this.name = snap.name;
        this.created = new Date(snap.created);
        this.fresh = snap.fresh;
    }

    async rename(name) {
        await this._fetch('', {method: 'POST', json: {name}});
    }

    async restore() {
        await this._fetch(`/restore`, {method: 'POST'});
    }

    async delete() {
        await this._fetch('', {method: 'DELETE'});
    }

    async _fetch(endpoint, options) {
        return await this.instance._fetch(`/snapshots/${this.id}${endpoint}`, options);
    }
}

module.exports = Snapshot;
