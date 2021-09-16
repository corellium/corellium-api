"use strict";

const { fetchApi } = require("./util/fetch");
const Instance = require("./instance");
const InstanceUpdater = require("./instance-updater");
const uuidv4 = require("uuid/v4");
const Resumable = require("../resumable");
const util = require("util");
const fs = require("fs");
const path = require("path");

class File {
    constructor({ filePath, type, size }) {
        this.path = filePath;
        this.name = path.basename(filePath);
        this.type = type;
        this.size = size;
    }

    slice(start, end, _contentType) {
        return fs.createReadStream(this.path, { start, end });
    }
}

/**
 * @typedef {object} ProjectKey
 * @property {string} identifier
 * @property {string} label
 * @property {string} key
 * @property {'ssh'|'adb'} kind - public key
 * @property {string} fingerprint
 * @property {string} createdAt - ISO datetime string
 * @property {string} updatedAt - ISO datetime string
 */

/**
 * @typedef {object} KernelImage
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} ProjectImage
 * @property {string} status - "active"
 * @property {string} id - uuid needed to pass to a createInstance call if this is a kernel
 * @property {string} name - "Image"
 * @property {string} type - "kernel"
 * @property {string} self - uri
 * @property {string} file - file uri
 * @property {number} size
 * @property {string} checksum
 * @property {string} encoding - "encrypted"
 * @property {string} project - Project uuid
 * @property {string} createdAt - ISO datetime string
 * @property {string} updatedAt - ISO datetime string
 */

/**
 * @typedef {object} ProjectQuotas
 * @property {number} cores - Number of available CPU cores
 */

/**
 * Instances of this class are returned from {@link Corellium#projects}, {@link
 * Corellium#getProject}, and {@link Corellium#projectNamed}. They should not
 * be created using the constructor.
 * @hideconstructor
 */
class Project {
    constructor(client, id) {
        this.client = client;
        this.api = this.client.api;
        this.id = id;
        this.token = null;
        this.updater = new InstanceUpdater(this);
    }

    /**
     * Reload the project info. This currently consists of name and quotas, but
     * will likely include more in the future.
     * @example
     * project.refresh();
     */
    async refresh() {
        this.info = await fetchApi(this, `/projects/${this.id}`);
    }

    /**
     * Returns refreshed authentication token
     * @return {string} token
     * @example
     * let token = await project.getToken()
     */
    async getToken() {
        return await this.client.getToken();
    }

    /**
     * Returns an array of the {@link Instance}s in this project.
     * @returns {Promise<Instance[]>} The instances in this project
     * @example <caption>Finding the first instance with a given name</caption>
     * const instances = await project.instances();
     * const instance = instances.find(instance => instance.name === 'Test Device');
     */
    async instances() {
        const instances = await fetchApi(this, `/projects/${this.id}/instances`);
        return await Promise.all(instances.map((info) => new Instance(this, info)));
    }

    /**
     * Returns the {@link Instance} with the given ID.
     * @param {string} id
     * @returns {Promise<Instance>}
     * @example
     * await project.getInstance('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
     */
    async getInstance(id) {
        const info = await fetchApi(this, `/instances/${id}`);
        return new Instance(this, info);
    }

    /**
     * Creates an instance and returns the {@link Instance} object. The options
     * are passed directly to the API.
     *
     * @param {Object} options - The options for instance creation. These are
     * the same as the JSON options passed to the instance creation API
     * endpoint. For a full list of possible options, see the API documentation.
     * @param {string} options.flavor - The device flavor, such as `iphone6`
     * @param {string} options.os - The device operating system version
     * @param {string} options.ipsw - The ID of a previously uploaded image in the project to use as the firmware
     * @param {string} options.osbuild - The device operating system build
     * @param {string} [options.snapshot] - The ID of snapshot to clone this device off of
     * @param {string} [options.name] - The device name
     * @param {string} [options.patches] - Instance patches, such as `jailbroken` (default), `nonjailbroken` or `corelliumd` which is non-jailbroken with API agent.
     * @param {Object} [options.bootOptions] - Boot options for the instance
     * @param {string} [options.bootOptions.kernelSlide] - Change the Kernel slide value for an iOS device.
     * When not set, the slide will default to zero. When set to an empty value, the slide will be randomized.
     * @param {string} [options.bootOptions.udid] - Predefined Unique Device ID (UDID) for iOS device
     * @param {string} [options.bootOptions.screen] - Change the screen metrics for Ranchu devices `XxY[:DPI]`, e.g. `720x1280:280`
     * @param {string[]} [options.bootOptions.additionalTags] - Addition features to utilize for the device, valid options include:<br>
     * `kalloc` : Enable kalloc/kfree trace access via GDB (Enterprise only)<br>
     * `gpu` : Enable cloud GPU acceleration (Extra costs incurred, cloud only)
     * @param {KernelImage} [options.bootOptions.kernel] - Custom kernel to pass to the device on creation.
     * @returns {Promise<Instance>}
     *
     * @example <caption>Creating an instance and waiting for it to start its first boot</caption>
     * const instance = await project.createInstance({
     *     flavor: 'iphone6',
     *     os: '11.3',
     *     name: 'Test Device',
     *     osbuild: '15E216',
     *     patches: 'corelliumd',
     *     bootOptions: {
     *         udid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     *     },
     * });
     * await instance.finishRestore();
     */
    async createInstance(options) {
        const { id } = await fetchApi(this, "/instances", {
            method: "POST",
            json: Object.assign({}, options, { project: this.id }),
        });
        return await this.getInstance(id);
    }

    /**
     * Get the VPN configuration to connect to the project network. This is only
     * available for cloud. At least one instance must be on in the project.
     *
     * @param {string} type -       Could be either "ovpn" or "tblk" to select between OpenVPN and TunnelBlick configuration formats.
     *                              TunnelBlick files are delivered as a ZIP file and OpenVPN configuration is just a text file.
     * @param {string} clientUUID - An arbitrary UUID to uniquely associate this VPN configuration with so it can be later identified
     *                              in a list of connected clients. Optional.
     * @returns {Promise<Buffer>}
     * @example
     * await project.vpnConfig('ovpn', undefined)
     */
    async vpnConfig(type = "ovpn", clientUUID) {
        if (!clientUUID) clientUUID = uuidv4();

        const response = await fetchApi(
            this,
            `/projects/${this.id}/vpn-configs/${clientUUID}.${type}`,
            { response: "raw" },
        );
        return await response.buffer();
    }

    /** Destroy this project.
     * @example
     * project.destroy();
     */
    async destroy() {
        return await fetchApi(this, `/projects/${this.id}`, {
            method: "DELETE",
        });
    }

    /**
     * The project quotas.
     * @returns {ProjectQuotas}
     * @example
     * // Create map of supported devices.
     * let supported = {};
     * (await corellium.supported()).forEach(modelInfo => {
     *     supported[modelInfo.name] = modelInfo;
     * });
     *
     * // Get how many CPUs we're currently using.
     * let cpusUsed = 0;
     * instances.forEach(instance => {
     *     cpusUsed += supported[instance.flavor].quotas.cpus;
     * });
     *
     * console.log('Used: ' + cpusUsed + '/' + project.quotas.cpus);
     */
    get quotas() {
        return this.info.quotas;
    }

    set quotas(quotas) {
        this.setQuotas(quotas);
    }

    /**
     * Sets the project quotas. Only the cores property is currently respected.
     *
     * @param {ProjectQuotas} quotas
     */
    async setQuotas(quotas) {
        this.info.quotas = Object.assign({}, this.info.quotas, quotas);
        await fetchApi(this, `/projects/${this.id}`, {
            method: "PATCH",
            json: {
                quotas: {
                    cores: quotas.cores || quotas.cpus,
                },
            },
        });
    }

    /**
     * How much of the project's quotas are currently used. To ensure this information is up to date, call {@link Project#refresh()} first.
     * @property {number} cores - Number of used CPU cores
     * @example
     * project.quotasUsed();
     */
    get quotasUsed() {
        return this.info.quotasUsed;
    }

    /** The project's name.
     * @example
     * project.name();
     */
    get name() {
        return this.info.name;
    }

    /**
     * Returns a list of {@link Role}s associated with this project, showing who has permissions over this project.
     *
     * This function is only available to domain and project administrators.
     * @return {Role[]}
     * @example
     * await project.roles();
     */
    async roles() {
        const roles = await this.client.roles();
        return roles.get(this.id);
    }

    /**
     * Give permissions to this project for a {@link Team} or a {@link User} (adds a {@link Role}).
     *
     * This function is only available to domain and project administrators.
     * @param {User|Team} grantee - must be an instance of {@link User} or {@link Team}
     * @param {string} type - user ID
     * @example
     * project.createRole(grantee, 'user');
     */
    async createRole(grantee, type = "user") {
        await this.client.createRole(this.id, grantee, type);
    }

    /**
     * Returns a list of authorized keys associated with the project. When a new
     * instance is created in this project, its authorized_keys (iOS) or adbkeys
     * (Android) will be populated with these keys by default. Adding or
     * removing keys from the project will have no effect on existing instances.
     *
     * @returns {Promise<ProjectKey[]>}
     * @example
     * let keys = project.keys();
     * for(let key of keys)
     *   console.log(key);
     */
    async keys() {
        return await this.client.projectKeys(this.id);
    }

    /**
     * Add a public key to project.
     *
     * @param {string} key - the public key, as formatted in a .pub file
     * @param {'ssh'|'adb'} kind
     * @param {string} [label] - defaults to the public key comment, if present
     *
     * @returns {Promise<ProjectKey>}
     * @example
     * project.addKey(key, 'ssh', 'SSH Key');
     */
    async addKey(key, kind = "ssh", label = null) {
        return await this.client.addProjectKey(this.id, key, kind, label);
    }

    /**
     * Delete public key from the project
     * @param {string} keyId
     * @example
     * project.deleteKey('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
     */
    async deleteKey(keyId) {
        return await this.client.deleteProjectKey(this.id, keyId);
    }

    /**
     * Add a kernel image to a project for use in creating new instances.
     *
     * @param {string} path - The path on the local file system to get the zipped kernel file.
     * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
     * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
     *
     * @returns {Promise<KernelImage>}
     */
    async uploadKernel(path, name, progress) {
        let image = await this.uploadImage(uuidv4(), "kernel", path, name, progress);
        return { id: image.id, name: image.name };
    }

    /**
     * Add an image to the project. These images may be removed at any time and are meant to facilitate creating a new Instance with images.
     *
     * @param {string} id - UUID of the image to create. Required to be universally unique but can be user-provided. You may resume uploads if you provide the same UUID.
     * @param {string} type - E.g. fw for the main firmware image.
     * @param {string} path - The path on the local file system to get the file.
     * @param {string} name - The name of the file to identify the file on the server. Usually the basename of the path.
     * @param {Project~progressCallback} [progress] - The callback for file upload progress information.
     *
     * @returns {Promise<ProjectImage>}
     */
    async uploadImage(id, type, path, name, progress) {
        const token = await this.getToken();
        return new Promise((resolve, reject) => {
            const url =
                this.api +
                "/projects/" +
                encodeURIComponent(this.id) +
                "/image-upload/" +
                encodeURIComponent(type) +
                "/" +
                encodeURIComponent(id) +
                "/" +
                encodeURIComponent(name);
            const r = new Resumable({
                target: url,
                headers: {
                    Authorization: token,
                    "x-corellium-image-encoding": "plain",
                },
                uploadMethod: "PUT",
                chunkSize: 5 * 1024 * 1024,
                prioritizeFirstAndLastChunk: true,
                method: "octet",
            });

            r.on("fileAdded", (_file) => {
                r.upload();
            });

            r.on("progress", () => {
                if (progress) progress(r.progress());
            });

            r.on("fileError", (_file, message) => {
                reject(message);
            });

            r.on("fileSuccess", (_file, message) => {
                resolve(JSON.parse(message));
            });

            return util
                .promisify(fs.stat)(path)
                .then((stat) => {
                    const file = new File({
                        filePath: path,
                        type: "application/octet-stream",
                        size: stat.size,
                    });

                    r.addFile(file);
                });
        });
    }
}

module.exports = Project;
