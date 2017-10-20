/**
 * Returns a stream {Promise} which returns a {Buffer} of the stream contents
 *
 * @param stream
 *
 * @returns {Promise}
 */
module.exports.streamPromise = stream => new Promise((resolve, reject) => {
  const buffer = [];
  stream.on('data', (data) => {
    buffer.push(data);
  });
  stream.on('end', () => {
    console.log('end');
    resolve(Buffer.concat(buffer));
  });
  stream.on('error', (err) => {
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
module.exports.getResourceBufferPromise = function (resource) {
  // might be a string
  if (typeof resource === 'string') {
    resource = new Buffer(resource);
    // fallthrough
  }
  // might already be a Buffer
  if (resource instanceof Buffer) {
    return Promise.resolve(resource);
  }
  // probably a stream
  // TODO npe/type check
  return this.streamPromise(resource);
};
