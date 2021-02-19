/// <reference types="node" />
/**
 * Returns a stream {Promise} which returns a {Buffer} of the stream contents
 *
 * @param stream
 *
 * @returns {Promise}
 */
import * as Promise from "bluebird";
import ReadableStream = NodeJS.ReadableStream;
export declare const streamPromise: (stream: ReadableStream) => Promise<unknown>;
/**
 * Returns a given resource as a Buffer (promise)
 *
 * @param {Stream|Buffer|String} resource
 *
 * @returns {Promise}
 */
export declare function getResourceBufferPromise(resource: ReadableStream | Buffer | string): Promise<Buffer>;
