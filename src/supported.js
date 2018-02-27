const supportedDevices = require('./util/supporteddevices');

class SupportedFirmware {
    constructor(device, info) {
        this.device = device;
        this.info = info;
    }
}

class SupportedDevice {
    constructor(info, ipsws) {
        this.info = info;
        this.details = Object.assign({}, ipsws);
        delete this.details['firmwares'];

        this.firmwares = ipsws['firmwares'].map(ipsw => {
            return new SupportedFirmware(this, ipsw);
        });
    }
    
    find(options) {
        for (let firmware of this.firmwares) {
            let matches = Object.keys(options).every(option => {
                let value = new RegExp(options[option]);
                if (firmware.info[option] && firmware.info[option].search(value) !== -1)
                    return true;
                
                return false;
            });

            if (matches)
                return firmware;
        };
    }
}

class SupportedDevices {
    constructor(ipsws) {
        let devices = supportedDevices.devices;
        
        let supported = new Map();
        devices.forEach(device => {
            if (ipsws[device.product])
                supported.set(device.flavorId, new SupportedDevice(device, ipsws[device.product]));
        });

        this.devices = supported;
    }

    find(options) {
        for (let [flavorId, device] of this.devices) {
            let matches = Object.keys(options).every(option => {
                let value = new RegExp(options[option]);
                if (device.info[option] && device.info[option].search(value) !== -1)
                    return true;
                
                if (device.details[option] && device.details[option].search(value) !== -1)
                    return true;

                return false;
            });

            if (matches)
                return device;
        };
    }
}

module.exports = {
    SupportedDevices: SupportedDevices,
    SupportedDevice: SupportedDevice,
    SupportedFirmware: SupportedFirmware
};
