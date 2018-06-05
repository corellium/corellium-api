// Wrapper around node-fetch that adds a few goodies:
//  - token option that sets Authorization header
//  - json option that automatically does JSON.stringify and sets Content-Type: application/json
//  - throws CorelliumErrors for API errors
//  - returns the parsed JSON response
const nodeFetch = require('node-fetch');

class CorelliumError extends Error {
    constructor(message, code) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
    }
}

async function fetch(url, {json, token, ...options}) {
    if (options.headers === undefined)
        options.headers = {};

    if (json !== undefined) {
        options.body = JSON.stringify(json);
        options.headers['Content-Type'] = 'application/json';
    }
    if (token !== undefined) {
        options.headers['Authorization'] = token;
    }

    const res = await nodeFetch(url, options);
    if (res.status == 204)
        return;
    if (res.status >= 400 && res.status < 500) {
        const body = await res.json();
        throw new CorelliumError(body.error, res.status);
    } else if (res.status >= 500) {
        throw new Error(`${res.status} ${res.statusText}`);
    }
    if (options.response === 'raw')
        return res;
    return await res.json();
}

async function fetchApi(client, endpoint, options = {}) {
    options.token = await client.getToken();
    return fetch(`${client.api}${endpoint}`, options);
}

module.exports = {
    fetch, fetchApi,
    CorelliumError,
};
