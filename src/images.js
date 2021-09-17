"use strict";

const Resumable = require("../resumable");
const util = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");
const JSZip = require("jszip");

/**
 * @typedef {object} KernelImage
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} FirmwareImage
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} Image
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

function isCompressed(data) {
    return Buffer.compare(data.slice(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04])) === 0;
}

async function compress(data, name) {
    var zip = new JSZip();
    var tmpfile = path.join(os.tmpdir(), name);
    zip.file(name, data);

    const streamZip = new Promise((resolve, reject) => {
        zip.generateNodeStream({
            type: "nodebuffer",
            streamFile: true,
        })
            .pipe(fs.createWriteStream(tmpfile))
            .on("finish", function () {
                resolve();
            })
            .on("error", function (err) {
                reject(err);
            });
    });

    await streamZip;

    return tmpfile;
}

async function uploadFile(token, url, filePath, progress) {
    return new Promise((resolve, reject) => {
        const r = new Resumable({
            target: url,
            headers: {
                authorization: token,
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
            .promisify(fs.stat)(filePath)
            .then((stat) => {
                const file = new File({
                    filePath: filePath,
                    type: "application/octet-stream",
                    size: stat.size,
                });

                r.addFile(file);
            });
    });
}

module.exports = {
    isCompressed,
    compress,
    uploadFile,
};
