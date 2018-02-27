const WebCrypto = require("node-webcrypto-ossl");
const webcrypto = new WebCrypto();

const RouterKeyAlgo = {
    name: 'AES-GCM',
    length: 128
};

function unformatKey(hex) {
    let keyBytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < keyBytes.byteLength; ++i) {
        keyBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return keyBytes;
}

function importRouterKey(key) {
    return webcrypto.subtle.importKey('raw', unformatKey(key), RouterKeyAlgo, false, ['encrypt', 'decrypt']);
}

function decryptRouterInfo(key, message) {
    let myAlgo = Object.assign({}, RouterKeyAlgo);
    return importRouterKey(key).then(key => {
        myAlgo.iv = message.slice(0, 16);
        return webcrypto.subtle.decrypt(myAlgo, key, message.slice(16)).then(data => {
            return JSON.parse(Buffer.from(data).toString('utf8'));
        });
    });
}

module.exports = {
    decryptRouterInfo: decryptRouterInfo
};
