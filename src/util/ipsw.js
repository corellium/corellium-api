const fetch = require('node-fetch');
const config = require('openstack-api').config;
const filters = config.ipswFilters;
const REMOTE_URL = config.ipswUrl || 'http://api.ipsw.me/v2.1/firmwares.json';
const TIMEOUT = 60 * 30 * 1000;
const supportedDevices = require('./supporteddevices');

function parseVersionStr(versionStr) {
    let parts = versionStr.split('.');
    let parsed = 0;
    if (parts.length > 0)
        parsed += parseInt(parts[0]) * 100 * 100;
    if (parts.length > 1)
        parsed += parseInt(parts[1]) * 100;
    if (parts.length > 2)
        parsed += parseInt(parts[2]);
    return parsed;
}

class CachedIPSW {
    constructor(supportedDevices) {
        this.supportedDevices = supportedDevices;
        this.date = null;
        this.data = null;
        this.md5 = null;
    }

    parse(json, md5) {
        let devices = json['devices'];
        let supportedDevices = {};
        this.supportedDevices.forEach(device => {
            let data = devices[device.product];
            if (!data)
                return;

            data['firmwares'] = data['firmwares'] && data['firmwares'].filter(firmware => {
                let included = true;
                let version = parseVersionStr(firmware['version']);

                if (filters) {
                    filters.forEach(filter => {
                        if (filter.version) {
                            if (filter.version.ge && !(version >= parseVersionStr(filter.version.ge)))
                                return;
                            if (filter.version.gt && !(version > parseVersionStr(filter.version.gt)))
                                return;
                            if (filter.version.le && !(version <= parseVersionStr(filter.version.le)))
                                return;
                            if (filter.version.lt && !(version < parseVersionStr(filter.version.lt)))
                                return;
                            if (filter.version.eq && !(version === parseVersionStr(filter.version.eq)))
                                return;
                        }

                        if (filter.device) {
                            if (!Object.keys(filter.device).every(key => {
                                if (device[key].match(new RegExp(filter.device[key])))
                                    return true;

                                return false;
                            }))
                                return;
                        }
                        
                        if (filter.include) {
                            included = true;
                        } else if (filter.exclude) {
                            included = false;
                        }
                    });
                }

                return included;
            });

            if (data['firmwares'] && data['firmwares'].length > 0)
                supportedDevices[device.product] = data;
        });

        this.date = new Date();
        this.data = supportedDevices;
        this.md5 = md5;

        return supportedDevices;
    }

    uncachedGet() {
        if (!config.quiet)
            console.log('Performing uncached get to ' + REMOTE_URL);
        return fetch(REMOTE_URL).then(response => {
            return response.json().then(json => {
                return this.parse(json, response.headers.get('content-md5'));
            });
        });
    }

    get() {
        if (this.data && this.date && ((new Date()).getTime() - this.date.getTime()) < TIMEOUT)
            return Promise.resolve(this.data);

        if (this.data && this.md5) {
            if (!config.quiet)
                console.log('Performing HEAD of ' + REMOTE_URL);
            return fetch(REMOTE_URL, {
                method: 'HEAD'
            }).then(response => {
                if (this.md5 === response.headers.get('content-md5')) {
                    this.date = new Date();
                    return this.data;
                } else
                    return this.uncachedGet();
            });
        }

        return this.uncachedGet();
    }
}

let cache = new Map();

function get_ipsw_for_supported_devices(supportedDevices) {
    let key = JSON.stringify(supportedDevices.products.sort());
    let cached = cache.get(key);
    if (cached)
        return cached.get();

    cached = new CachedIPSW(supportedDevices.devices);
    cache.set(key, cached);
    return cached.get();
}

module.exports = get_ipsw_for_supported_devices.bind(module, supportedDevices);
