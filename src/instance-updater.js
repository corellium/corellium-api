"use strict";

const { fetchApi } = require("./util/fetch");

class InstanceUpdater {
  constructor(project) {
    this.project = project;
    this.instances = new Map();
    this.updating = false;
    this.updateInterval = 5000;
  }

  add(instance) {
    //console.log(new Error().stack);
    this.instances.set(instance.id, instance);
    this.startUpdating();
  }
  remove(instance) {
    this.instances.delete(instance.id);
  }

  async startUpdating() {
    if (this.updating) return;
    this.updating = true;

    while (this.instances.size != 0) {
      try {
        const ids = [...this.instances.keys()];
        let url;
        if (ids.length < 100) url = `/instances?id=${ids.join(",")}`;
        else url = `/instances`;

        const infos = await fetchApi(this.project, url);
        for (const info of infos) {
          if (this.instances.has(info.id))
            this.instances.get(info.id).receiveUpdate(info);
        }
        for (const id of ids) {
          if (this.instances.has(id) && !infos.find((info) => info.id === id)) {
            // instance was deleted
            this.instances.get(id).receiveUpdate({ state: "deleted" });
            this.instances.delete(id);
          }
        }
      } catch (e) {
        // this is a background task, so the only sane way to handle an exception is to log it
        console.error(
          "error asking for instance update",
          this.project.id,
          e.stack
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.updateInterval));
    }

    this.updating = false;
  }
}

module.exports = InstanceUpdater;
