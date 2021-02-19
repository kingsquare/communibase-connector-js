"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = require("axios");
const async_1 = require("async");
const Promise = require("bluebird");
const http_1 = require("http");
const https_1 = require("https");
const lru_cache_1 = require("lru-cache");
const moment_1 = require("moment");
const socket_io_client_1 = require("socket.io-client");
const stream_1 = require("stream");
const winston_1 = require("winston");
const util_1 = require("./util");
function defer() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {
        // @ts-ignore
        resolve,
        // @ts-ignore
        reject,
        promise,
    };
}
class CommunibaseError extends Error {
    constructor(data, task) {
        super(data.message);
        this.name = "CommunibaseError";
        this.code = data.code || 500;
        this.message = data.message || "";
        this.errors = data.errors || {};
        // Error.captureStackTrace(this, CommunibaseError);
    }
}
/**
 * Constructor for connector.
 *
 * @param key - The communibase api key
 * @constructor
 */
// tslint:disable-next-line:max-classes-per-file
class Connector {
    constructor(key) {
        this.getByIdQueue = {};
        this.getByIdPrimed = false;
        this.key = key;
        this.token = "";
        this.serviceUrl =
            process.env.COMMUNIBASE_API_URL || "https://api.communibase.nl/0.1/";
        this.serviceUrlIsHttps = this.serviceUrl.indexOf("https") === 0;
        this.queue = async_1.default.queue((task, callback) => {
            function fail(error) {
                if (error instanceof Error) {
                    task.deferred.reject(error);
                }
                else {
                    task.deferred.reject(new CommunibaseError(error, task));
                }
                callback();
                return;
            }
            if (!this.key && !this.token) {
                fail(new Error("Missing key or token for Communibase Connector: please set COMMUNIBASE_KEY environment" +
                    " variable, or spawn a new instance using require('communibase-connector-js').clone('<" +
                    "your api key>')"));
                return;
            }
            if (!task.options.headers) {
                task.options.headers = {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                };
            }
            if (process.env.COMMUNIBASE_API_HOST) {
                task.options.headers.Host = process.env.COMMUNIBASE_API_HOST;
            }
            if (this.key) {
                task.options.headers["x-api-key"] = this.key;
            }
            if (this.token) {
                task.options.headers["x-access-token"] = this.token;
            }
            axios_1.default
                .request(Object.assign({ url: task.url }, task.options))
                .then((result) => {
                const { deferred } = task;
                let records = result.data;
                if (records.metadata && records.records) {
                    deferred.promise.metadata = records.metadata;
                    // eslint-disable-next-line prefer-destructuring
                    records = records.records;
                }
                deferred.resolve(records);
                callback();
                return null;
            })
                .catch((err) => {
                var _a;
                fail(((_a = err.response) === null || _a === void 0 ? void 0 : _a.data) || err);
            });
        }, 8);
    }
    setServiceUrl(newServiceUrl) {
        if (!newServiceUrl) {
            throw new Error("Cannot set empty service-url");
        }
        this.serviceUrl = newServiceUrl;
        this.serviceUrlIsHttps = newServiceUrl.indexOf("https") === 0;
    }
    /**
     * Return the configured service url
     */
    getServiceUrl() {
        return this.serviceUrl;
    }
    ;
    /**
     * Get a single object by its id
     *
     * @param {string} objectType - E.g. Person
     * @param {string}objectId - E.g. 52259f95dafd757b06002221
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @param {string|null} [versionId=null] - optional versionId to retrieve
     * @returns {Promise} - for object: a key/value object with object data
     */
    getById(objectType, objectId, params, versionId) {
        if (typeof objectId !== "string" || objectId.length !== 24) {
            return Promise.reject(new Error("Invalid objectId"));
        }
        // not combinable...
        if (versionId || (params && params.fields)) {
            const deferred = defer();
            this.queue.push({
                deferred,
                url: `${this.serviceUrl + objectType}.json/${versionId ? `history/${objectId}/${versionId}` : `crud/${objectId}`}`,
                options: {
                    method: "GET",
                    params,
                },
            });
            return deferred.promise;
        }
        // cached?
        if (this.cache && this.cache.isAvailable(objectType, objectId)) {
            return this.cache.objectCache[objectType][objectId];
        }
        // since we are not requesting a specific version or fields, we may combine the request..?
        if (this.getByIdQueue[objectType] === undefined) {
            this.getByIdQueue[objectType] = {};
        }
        if (this.getByIdQueue[objectType][objectId]) {
            // requested twice?
            return this.getByIdQueue[objectType][objectId].promise;
        }
        this.getByIdQueue[objectType][objectId] = defer();
        if (this.cache) {
            if (this.cache.objectCache[objectType] === undefined) {
                this.cache.objectCache[objectType] = {};
            }
            this.cache.objectCache[objectType][objectId] = this.getByIdQueue[objectType][objectId].promise;
        }
        if (!this.getByIdPrimed) {
            process.nextTick(() => {
                this.spoolQueue();
            });
            this.getByIdPrimed = true;
        }
        return this.getByIdQueue[objectType][objectId].promise;
    }
    /**
     * Get an array of objects by their ids
     * If one or more entries are found, they are returned as an array of values
     *
     * @param {string} objectType - E.g. Person
     * @param {Array} objectIds - objectIds - E.g. ['52259f95dafd757b06002221']
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getByIds(objectType, objectIds, params) {
        if (objectIds.length === 0) {
            return Promise.resolve([]);
        }
        // not combinable...
        if (params && params.fields) {
            return this.privateGetByIds(objectType, objectIds, params);
        }
        return Promise.map(objectIds, (objectId) => this.getById(objectType, objectId, params).reflect()).then((inspections) => {
            const result = [];
            let error = null;
            inspections.forEach((inspection) => {
                if (inspection.isRejected()) {
                    error = inspection.reason();
                    return;
                }
                result.push(inspection.value());
            });
            if (result.length) {
                return result;
            }
            if (error) {
                throw new Error(error);
            }
            // return the empty array, if no results and no error
            return result;
        });
    }
    /**
     * Get all objects of a certain type
     *
     * @param {string} objectType - E.g. Person
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getAll(objectType, params) {
        if (this.cache && !(params && params.fields)) {
            return this.search(objectType, {}, params);
        }
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/crud`,
            options: {
                method: "GET",
                params,
            },
        });
        return deferred.promise;
    }
    /**
     * Get result objectIds of a certain search
     *
     * @param {string} objectType - E.g. Person
     * @param {object} selector - { firstName: "Henk" }
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getIds(objectType, selector, params) {
        let hash;
        let result;
        if (this.cache) {
            hash = JSON.stringify([objectType, selector, params]);
            if (!this.cache.getIdsCaches[objectType]) {
                this.cache.getIdsCaches[objectType] = new lru_cache_1.default(1000); // 1000 getIds are this.cached, per entityType
            }
            const objectTypeGetIdCache = this.cache.getIdsCaches[objectType];
            result = objectTypeGetIdCache ? objectTypeGetIdCache.get(hash) : null;
            if (result) {
                return Promise.resolve(result);
            }
        }
        const resultPromise = this.search(objectType, selector || {}, Object.assign({ fields: "_id" }, params)).then((results) => results.map((obj) => obj._id));
        if (this.cache) {
            return resultPromise.then((ids) => {
                if (this.cache) {
                    const objectTypeGetIdCache = this.cache.getIdsCaches[objectType];
                    if (objectTypeGetIdCache) {
                        objectTypeGetIdCache.set(hash, ids);
                    }
                }
                return ids;
            });
        }
        return resultPromise;
    }
    /**
     * Get the id of an object based on a search
     *
     * @param {string} objectType - E.g. Person
     * @param {object} selector - { firstName: "Henk" }
     * @returns {Promise} - for a string OR undefined if not found
     */
    getId(objectType, selector) {
        return this.getIds(objectType, selector, { limit: 1 }).then((ids) => ids.pop() || null);
    }
    /**
     *
     * @param objectType
     * @param selector - mongodb style
     * @param params
     * @returns {Promise} for objects
     */
    search(objectType, selector, params) {
        if (this.cache && !(params && params.fields)) {
            return this.getIds(objectType, selector, params).then((ids) => this.getByIds(objectType, ids));
        }
        if (selector &&
            typeof selector === "object" &&
            Object.keys(selector).length) {
            return this.queueSearch(objectType, selector, params);
        }
        return this.getAll(objectType, params);
    }
    /**
     * This will save a document in Communibase. When a _id-field is found, this document will be updated
     *
     * @param objectType
     * @param object - the to-be-saved object data
     * @returns promise for object (the created or updated object)
     */
    update(objectType, object) {
        const deferred = defer();
        const operation = object._id && object._id.length > 0 ? "PUT" : "POST";
        if (object._id &&
            this.cache &&
            this.cache.objectCache &&
            this.cache.objectCache[objectType] &&
            this.cache.objectCache[objectType][object._id]) {
            this.cache.objectCache[objectType][object._id] = null;
        }
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/crud${operation === "PUT" ? `/${object._id}` : ""}`,
            options: {
                method: operation,
                data: object,
            },
        });
        return deferred.promise;
    }
    /**
     * Delete something from Communibase
     *
     * @param objectType
     * @param objectId
     * @returns promise (for null)
     */
    destroy(objectType, objectId) {
        const deferred = defer();
        if (this.cache &&
            this.cache.objectCache &&
            this.cache.objectCache[objectType] &&
            this.cache.objectCache[objectType][objectId]) {
            this.cache.objectCache[objectType][objectId] = null;
        }
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/crud/${objectId}`,
            options: {
                method: "DELETE",
            },
        });
        return deferred.promise;
    }
    /**
     * Undelete something from Communibase
     *
     * @param objectType
     * @param objectId
     * @returns promise (for null)
     */
    undelete(objectType, objectId) {
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/history/undelete/${objectId}`,
            options: {
                method: "POST",
            },
        });
        return deferred.promise;
    }
    /**
     * Get a Promise for a Read stream for a File stored in Communibase
     *
     * @param fileId
     * @returns {Stream} see http://nodejs.org/api/stream.html#stream_stream
     */
    createReadStream(fileId) {
        const request = this.serviceUrlIsHttps ? https_1.request : http_1.request;
        const fileStream = new stream_1.PassThrough();
        const req = request(`${this.serviceUrl}File.json/binary/${fileId}?api_key=${this.key}`, (res) => {
            if (res.statusCode === 200) {
                res.pipe(fileStream);
                return;
            }
            fileStream.emit("error", new Error(http_1.STATUS_CODES[res.statusCode || 500]));
            fileStream.emit("end");
        });
        if (process.env.COMMUNIBASE_API_HOST) {
            req.setHeader("Host", process.env.COMMUNIBASE_API_HOST);
        }
        req.end();
        req.on("error", (err) => {
            fileStream.emit("error", err);
        });
        return fileStream;
    }
    /**
     * Uploads the contents of the resource to Communibase (updates or creates a new File)
     *
     * Note `File` is not versioned
     *
     * @param {Stream|Buffer|String} resource a stream, buffer or a content-string
     * @param {String} name The binary name (i.e. a filename)
     * @param {String} destinationPath The "directory location"
     * @param {String} id The `File` id to replace the contents of (optional; if not set then creates a new File)
     *
     * @returns {Promise}
     */
    updateBinary(resource, name, destinationPath, id) {
        const metaData = {
            path: destinationPath,
        };
        return util_1.getResourceBufferPromise(resource).then((buffer) => {
            if (id) {
                // TODO check is valid id? entails extra dependency (mongodb.ObjectID)
                // update File identified by id
                return this.update("File", {
                    _id: id,
                    filename: name,
                    length: buffer.length,
                    uploadDate: moment_1.default().format(),
                    metadata: metaData,
                    content: buffer,
                });
            }
            // create a new File
            const deferred = defer();
            const formData = new FormData();
            let stringOrBlob = buffer;
            // @see https://developer.mozilla.org/en-US/docs/Web/API/FormData/append
            // officially, formdata may contain blobs or strings. node doesn't do blobs, but when polymorphing in a browser we
            // may cast it to one for it to work properly...
            if (typeof window !== "undefined" && window.Blob) {
                stringOrBlob = new Blob([buffer]);
            }
            formData.append("File", stringOrBlob, name);
            formData.append("metadata", JSON.stringify(metaData));
            this.queue.push({
                deferred,
                url: `${this.serviceUrl}File.json/binary`,
                options: {
                    method: "POST",
                    data: formData,
                    headers: {
                        Accept: "application/json",
                    },
                },
            });
            return deferred.promise;
        });
    }
    /**
     * Get a new Communibase Connector, may be with a different API key
     *
     * @param apiKey
     * @returns {Connector}
     */
    clone(apiKey) {
        return new Connector(apiKey);
    }
    /**
     * Get the history information for a certain type of object
     *
     * VersionInformation:  {
     *    "_id": "ObjectId",
     *    "updatedAt": "Date",
     *    "updatedBy": "string"
     * }
     *
     * @param {string} objectType
     * @param {string} objectId
     * @returns promise for VersionInformation[]
     */
    getHistory(objectType, objectId) {
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/history/${objectId}`,
            options: {
                method: "GET",
            },
        });
        return deferred.promise;
    }
    /**
     *
     * @param {string} objectType
     * @param {Object} selector
     * @returns promise for VersionInformation[]
     */
    historySearch(objectType, selector) {
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/history/search`,
            options: {
                method: "POST",
                data: selector,
            },
        });
        return deferred.promise;
    }
    /**
     * Get a single object by a DocumentReference-object. A DocumentReference object looks like
     * {
     *  rootDocumentId: '524aca8947bd91000600000c',
     *  rootDocumentEntityType: 'Person',
     *  path: [
     *    {
     *      field: 'addresses',
     *      objectId: '53440792463cda7161000003'
     *    }, ...
     *  ]
     * }
     *
     * @param {object} ref - DocumentReference style, see above
     * @param {object} parentDocument
     * @return {Promise} for referred object
     */
    getByRef(ref, parentDocument) {
        if (!(ref &&
            ref.rootDocumentEntityType &&
            (ref.rootDocumentId || parentDocument))) {
            return Promise.reject(new Error("Please provide a documentReference object with a type and id"));
        }
        const rootDocumentEntityTypeParts = ref.rootDocumentEntityType.split(".");
        let parentDocumentPromise;
        if (rootDocumentEntityTypeParts[0] !== "parent") {
            parentDocumentPromise = this.getById(ref.rootDocumentEntityType, ref.rootDocumentId);
        }
        else {
            parentDocumentPromise = Promise.resolve(parentDocument);
        }
        if (!(ref.path && ref.path.length && ref.path.length > 0)) {
            return parentDocumentPromise;
        }
        /* tslint:disable no-parameter-reassignment */
        return parentDocumentPromise.then((result) => {
            ref.path.some((pathNibble) => {
                if (result && result[pathNibble.field]) {
                    if (!result[pathNibble.field].some((subDocument) => {
                        if (subDocument._id === pathNibble.objectId) {
                            result = subDocument;
                            return true;
                        }
                        return false;
                    })) {
                        result = null;
                        return true;
                    }
                    return false;
                }
                result = null;
                return true;
            });
            if (result) {
                return result;
            }
            throw new Error("The referred object within it's parent could not be found");
        });
        /* tslint:enable no-parameter-reassignment */
    }
    /**
     *
     * @param {string} objectType - E.g. Event
     * @param {array} aggregationPipeline - E.g. A MongoDB-specific Aggregation Pipeline
     * @see http://docs.mongodb.org/manual/core/aggregation-pipeline/
     *
     * E.g. [
     * { "$match": { "_id": {"$ObjectId": "52f8fb85fae15e6d0806e7c7"} } },
     * { "$unwind": "$participants" },
     * { "$group": { "_id": "$_id", "participantCount": { "$sum": 1 } } }
     * ]
     */
    aggregate(objectType, aggregationPipeline) {
        if (!aggregationPipeline || !aggregationPipeline.length) {
            return Promise.reject(new Error("Please provide a valid Aggregation Pipeline."));
        }
        let hash;
        if (this.cache) {
            hash = JSON.stringify([objectType, aggregationPipeline]);
            let objectTypeAggregateCache = this.cache.aggregateCaches[objectType];
            if (!objectTypeAggregateCache) {
                objectTypeAggregateCache = lru_cache_1.default(1000); // // 1000 getIds are this.cached, per entityType
                this.cache.aggregateCaches[objectType] = objectTypeAggregateCache;
            }
            const result = objectTypeAggregateCache.get(hash);
            if (result) {
                return Promise.resolve(result);
            }
        }
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/aggregate`,
            options: {
                method: "POST",
                data: aggregationPipeline,
            },
        });
        const resultPromise = deferred.promise;
        if (this.cache) {
            return resultPromise.then((result) => {
                if (this.cache) {
                    const objectTypeAggregateCache = this.cache.aggregateCaches[objectType];
                    if (objectTypeAggregateCache) {
                        objectTypeAggregateCache.set(hash, result);
                    }
                }
                return result;
            });
        }
        return resultPromise;
    }
    /**
     * Finalize an invoice by its ID
     *
     * @param invoiceId
     * @returns {*}
     */
    finalizeInvoice(invoiceId) {
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl}Invoice.json/finalize/${invoiceId}`,
            options: {
                method: "POST",
            },
        });
        return deferred.promise;
    }
    /**
     * @param communibaseAdministrationId
     * @param socketServiceUrl
     */
    enableCache(communibaseAdministrationId, socketServiceUrl) {
        this.cache = {
            getIdsCaches: {},
            aggregateCaches: {},
            dirtySock: socket_io_client_1.default.connect(socketServiceUrl, { port: "443" }),
            objectCache: {},
            isAvailable(objectType, objectId) {
                if (!cache) {
                    return false;
                }
                return !!(cache.objectCache[objectType] &&
                    cache.objectCache[objectType][objectId]);
            },
        };
        const { cache } = this;
        cache.dirtySock.on("connect", () => {
            cache.dirtySock.emit("join", `${communibaseAdministrationId}_dirty`);
        });
        cache.dirtySock.on("message", (dirtyness) => {
            const dirtyInfo = dirtyness.split("|");
            if (dirtyInfo.length !== 2) {
                winston_1.default.warn(`${new Date()}: Got weird dirty sock data? ${dirtyness}`);
                return;
            }
            cache.getIdsCaches[dirtyInfo[0]] = null;
            cache.aggregateCaches[dirtyInfo[0]] = null;
            if (dirtyInfo.length === 2 && cache.objectCache[dirtyInfo[0]]) {
                cache.objectCache[dirtyInfo[0]][dirtyInfo[1]] = null;
            }
        });
    }
    queueSearch(objectType, selector, params) {
        const deferred = defer();
        this.queue.push({
            deferred,
            url: `${this.serviceUrl + objectType}.json/search`,
            options: {
                method: "POST",
                data: selector,
                params,
            },
        });
        return deferred.promise;
    }
    /**
     * Bare boned retrieval by objectIds
     * @returns {Promise}
     */
    privateGetByIds(objectType, objectIds, params) {
        return this.queueSearch(objectType, {
            _id: { $in: objectIds },
        }, params);
    }
    /**
     * Default object retrieval: should provide cachable objects
     */
    spoolQueue() {
        Object.keys(this.getByIdQueue).forEach((objectType) => {
            const deferredsById = this.getByIdQueue[objectType];
            const objectIds = Object.keys(deferredsById);
            this.getByIdQueue[objectType] = {};
            this.privateGetByIds(objectType, objectIds).then((objects) => {
                const objectHash = objects.reduce((previousValue, object) => {
                    if (object._id) {
                        previousValue[object._id] = object;
                    }
                    return previousValue;
                }, {});
                objectIds.forEach((objectId) => {
                    if (objectHash[objectId]) {
                        deferredsById[objectId].resolve(objectHash[objectId]);
                        return;
                    }
                    deferredsById[objectId].reject(new Error(`${objectId} is not found`));
                });
            }, (err) => {
                objectIds.forEach((objectId) => {
                    deferredsById[objectId].reject(err);
                });
            });
        });
        this.getByIdPrimed = false;
    }
}
exports.Connector = Connector;
// Backwards compatibility-ish
exports.default = new Connector(process.env.COMMUNIBASE_KEY);
//# sourceMappingURL=index.js.map