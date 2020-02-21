/**
 * Returns a stream {Promise} which returns a {Buffer} of the stream contents
 *
 * @param stream
 *
 * @returns {Promise}
 */
import * as Promise from "bluebird";
import ReadableStream = NodeJS.ReadableStream;

export const streamPromise = (stream: ReadableStream) =>
  new Promise((resolve, reject) => {
    const buffer: Buffer[] = [];
    stream.on("data", data => {
      buffer.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffer));
    });
    stream.on("error", err => {
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
export function getResourceBufferPromise(
  resource: ReadableStream | Buffer | string
): Promise<Buffer> {
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
