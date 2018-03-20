
class Snapshot {
    constructor(instance, info) {
        this.instance = instance;
        this.info = info;
    }

    id() {
        return this.info.id;
    }

    name() {
        return this.info.name;
    }

    created() {
        return new Date(this.info.created_at);
    }

    isFresh() {
        return !!this.info.metadata.fresh;
    }

    async restore() {
        let token = await this.instance.token();
        return openstack.helpers.restore_snapshot(token.token, this.instance.id(), this.info.volume_id, this.id());
    }
}

module.exports = Snapshot;
