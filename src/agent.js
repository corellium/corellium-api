const WebSocket = require('ws');

class Agent {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.active = true;
        this.pending = new Map();
        this.id = 0;
        this.connectPromise = null;
        this.connectResolve = null;
        this.reconnect();
    }
    
    reconnect() {
        if (!this.active)
            return;

        if (!this.connectPromise) {
            this.connectPromise = new Promise(resolve => {
                this.connectResolve = resolve;
            });
        }

        this.ws = new WebSocket(this.endpoint);
        this.ws.on('message', data => {
            try {
                let message;
                let id;
                if (typeof data === 'string') {
                    message = JSON.parse(data);
                    id = message['id'];
                } else if (data.length >= 8) {
                    id = data.readUInt32LE(0);
                    message = data.slice(8);
                }

                let handler = this.pending.get(id);
                if (handler) {
                    if (handler(null, message))
                        this.pending.delete(id);
                }
            } catch (err) {
                console.error(err);
            }
        });
        
        this.ws.on('open', err => {
            this.connectResolve();
            this.connectPromise = null;
            this.connectResolve = null;
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
                    this.active = true;
                    this.reconnect();
                    this.connectPromise.then(oldResolve);
                }, 1000);
            } else {
                console.error(err);
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

    disconnect() {
        this.active = false;
        this.ws.close();
    }

    command(message) {
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
}

module.exports = Agent;
