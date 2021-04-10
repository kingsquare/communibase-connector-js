"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResourceBufferPromise = exports.streamPromise = void 0;
/**
 * Returns a stream {Promise} which returns a {Buffer} of the stream contents
 *
 * @param stream
 *
 * @returns {Promise}
 */
const Promise = require("bluebird");
exports.streamPromise = (stream) => new Promise((resolve, reject) => {
    const buffer = [];
    stream.on("data", (data) => {
        buffer.push(data);
    });
    stream.on("end", () => {
        resolve(Buffer.concat(buffer));
    });
    stream.on("error", (err) => {
        reject(err);
    });
});
/**
 * Returns a given resource as a Buffer (promise)
 *
 * @param {Stream|Buffer|String} resource
 *
 * @returns {Promise}
 */
function getResourceBufferPromise(resource) {
    // might be a string
    if (typeof resource === "string") {
        return Promise.resolve(new Buffer(resource));
    }
    // might already be a Buffer
    if (resource instanceof Buffer) {
        return Promise.resolve(resource);
    }
    // probably a stream
    // @TODO npe/type check
    // @ts-ignore
    return this.streamPromise(resource);
}
exports.getResourceBufferPromise = getResourceBufferPromise;
//# sourceMappingURL=util.js.map