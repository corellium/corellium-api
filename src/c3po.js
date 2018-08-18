const WebSocket = require('ws');
const HKDF = require('hkdf');
const crypto = require('crypto');

class HypervisorStream {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.active = true;
        this.pending = new Map();
        this.id = 0;
        this.timeout = null;
        this.connectPromise = null;
        this.connectResolve = null;
        this.connectReject = null;
        this.reconnect();
        this.resetTimeout();
    }

    reconnect() {
        if (!this.active)
            return;

        if (!this.connectPromise) {
            this.connectPromise = new Promise((resolve, reject) => {
                this.connectResolve = resolve;
                this.connectReject = reject;
            });
        }

        this.ws = new WebSocket(this.endpoint);
        this.ws.on('message', data => {
            try {
                let message = JSON.parse(data);
                let id = message['id'];
                let handler = this.pending.get(id);
                if (handler) {
                    handler(null, message);
                    this.pending.delete(id);
                }
            } catch (err) {
                console.error('error in HypervisorStream message handler', err);
            }
        });
        
        this.ws.on('open', err => {
            this.connectResolve();
            this.connectPromise = null;
            this.connectResolve = null;
            this.connectReject = null;
        });

        this.ws.on('error', err => {
            this.pending.forEach(handler => {
                handler(err);
            });
            this.pending = new Map();

            if (this.connectResolve) {
                let oldResolve = this.connectResolve;
                setTimeout(() => {
                    this.connectPromise = null;
                    this.connectResolve = null;
                    if (this.active) {
                        this.connectReject = null;
                        this.reconnect();
                        if (this.connectPromise)
                            this.connectPromise.then(oldResolve);
                    } else {
                        this.connectReject(err);
                        this.connectReject = null;
                    }
                }, 1000);
            } else {
                console.error('HypervisorStream error', err);
                this.disconnect();
            }
        });
        
        this.ws.on('close', () => {
            this.pending.forEach(handler => {
                handler(new Error('disconnected'));
            });
            this.pending = new Map();

            this.disconnect();
        });
    }

    resetTimeout() {
        if (this.timeout)
            clearTimeout(this.timeout);

        this.timeout = setTimeout(() => {
            this.disconnect();
        }, 10 * 60 * 1000);
    }

    disconnect() {
        this.active = false;
        this.ws.close();
        
        if (this.timeout)
            clearTimeout(this.timeout);
    }

    command(message) {
        this.resetTimeout();

        let send = () => {
            ++this.id;

            let id = this.id;
            return new Promise((resolve, reject) => {
                this.pending.set(id, (err, message) => {
                    if (err)
                        reject(err);
                    else
                        resolve(message);
                });

                this.ws.send(JSON.stringify(Object.assign({}, message, {
                    'id': id
                })));
            });
        };
        
        if (this.connectPromise)
            return this.connectPromise.then(send);

        return send();
    }
    
    async signedCommand(instanceId, key, command) {
        let hkdf = new HKDF('sha512', 'corellium-c3po-salt', key);
        let derived = await new Promise(resolve => {
            hkdf.derive('corellium-c3po-key-01', 32, key => {
                resolve(key);
            });
        });

        let signed = JSON.stringify({
            'command': command,
            'expires': (new Date((new Date()).getTime() + 5 * 60000)).toISOString()
        });

        let hmac = crypto.createHmac('sha384', derived);
        hmac.update(signed);
        
        return {
            'instance': instanceId,
            'data': signed,
            'sign': hmac.digest().toString('base64')
        };
    }
}

module.exports = {
    HypervisorStream: HypervisorStream
};
