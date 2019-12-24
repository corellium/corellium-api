// Wrapper around fetch that adds a few goodies:
//  - token option that sets Authorization header
//  - json option that automatically does JSON.stringify and sets Content-Type: application/json
//  - throws CorelliumErrors for API errors
//  - returns the parsed JSON response
const realFetch = require('cross-fetch');
const pRetry = require('p-retry');

class CorelliumError extends Error {
    constructor(error, code) {
        super(error.error);
        this.name = this.constructor.name;
        this.field = error.field;
        this.code = code;
    }
}

async function fetch(url, options) {
    if (options.headers === undefined)
        options.headers = {};

    if (options.json !== undefined) {
        options.body = JSON.stringify(options.json);
        options.headers['Content-Type'] = 'application/json';
        delete options.json;
    }
    if (options.token !== undefined) {
        options.headers['Authorization'] = options.token;
    }

    let res;
    while (true) {
        res = await pRetry(() => realFetch(url, options), {retries: 3});
        if (res.status == 429) {
            const retryAfter = res.headers.get('retry-after');
            await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
            continue;
        }
        break;
    }

    if (res.status == 204)
        return null;
    if (res.status >= 400 && res.status < 500) {
        const body = await res.json();
        throw new CorelliumError(body, res.status);
    } else if (res.status >= 500) {
        console.warn(`[fetch] ${options.method || 'GET'} ${url}, status: ${res.status}`);
        if (options.body)
            console.warn('request body', options.body);

        throw new Error(`${options.method || 'GET'} ${url} -- ${res.status} ${res.statusText}`);
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
