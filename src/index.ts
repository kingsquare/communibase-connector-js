import 'isomorphic-fetch';
import 'isomorphic-form-data';

import ReadableStream = NodeJS.ReadableStream;
import * as Promise from 'bluebird';
import async, { AsyncQueue } from 'async';
import http, { request as httpRequest } from 'http';
import https, { request as httpsRequest } from 'https';
import { PassThrough } from 'stream';
import socketIoClient from 'socket.io-client';
import moment from 'moment';
import winston from 'winston';

import { getResourceBufferPromise } from './util';
import lruCache, { Cache } from 'lru-cache';

export interface Deferred {
  resolve: Function;
  reject: Function;
  promise: Promise<any>&{metadata?:any};
}

export type CommunibaseEntityType = 'Person' | 'Membership' | 'Event' | 'Invoice' | 'Contact' | 'Debtor' | 'File'
  | string;

export interface CommunibaseDocument {
  _id: string;
  [prop: string]: any;
}

export interface CommunibaseDocumentReference {
  rootDocumentEntityType: CommunibaseEntityType;
  rootDocumentId: string;
  path: {
    field: string
    objectId: string;
  }[];
}

export interface CommunibaseVersionInformation {
  _id: string;
  updatedAt: string;
  updatedBy: string;
}

interface CommunibaseTask {
  options: {
    headers?: {
      Host?: string,
      'x-api-key'?: string,
      'x-access-token'?: string,
      Accept?: string,
      'Content-Type'?: string,
    },
    query?: {
      [key: string]: string;
    },
  };
  url: string;
  deferred: Deferred;
}

export interface CommunibaseParams {
  fields?: string;
  limit?: number;
}

function defer(): Deferred {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    resolve,
    reject,
    promise,
  };
}

class CommunibaseError extends Error {
  name: string;
  code: number;
  message: string;
  errors: {};

  constructor(data: { name: string, code: number, message: string, errors: {} }, task: CommunibaseTask) {
    super(data.message);
    this.name = 'CommunibaseError';
    this.code = (data.code || 500);
    this.message = (data.message || '');
    this.errors = (data.errors || {});
    // Error.captureStackTrace(this, CommunibaseError);
  }
}

/**
 * Constructor for connector.
 *
 * @param key - The communibase api key
 * @constructor
 */
export class Connector {
  private getByIdQueue: {
    [objectType: string]: {
      [objectId: string]: Deferred,
    };
  };
  private getByIdPrimed: boolean;
  private key: string;
  private token: string;
  private serviceUrl: string;
  private serviceUrlIsHttps: boolean;
  private queue: AsyncQueue<any>;
  private cache?: {
    objectCache: {
      [objectType: string]: {
        [objectId: string]: Promise<CommunibaseDocument>,
      };
    };
    aggregateCaches: {
      [objectType: string]: Cache<string, {}[]>;
    };
    getIdsCaches: {
      [objectType: string]: Cache<string, string[]>;
    };
    isAvailable(objectType: CommunibaseEntityType, objectId: string): boolean,
    dirtySock: SocketIOClient.Socket
  };

  constructor(key: string) {
    this.getByIdQueue = {};
    this.getByIdPrimed = false;
    this.key = key;
    this.token = '';
    this.setServiceUrl(process.env.COMMUNIBASE_API_URL || 'https://api.communibase.nl/0.1/');
    this.queue = async.queue(
      (task: CommunibaseTask, callback) => {
        function fail(error: Error): void {
          if (error instanceof Error) {
            task.deferred.reject(error);
          } else {
            task.deferred.reject(new CommunibaseError(error, task));
          }

          callback();
          return null;
        }

        if (!this.key && !this.token) {
          fail(new Error('Missing key or token for Communibase Connector: please set COMMUNIBASE_KEY environment' +
            ' variable, or spawn a new instance using require(\'communibase-connector-js\').clone(\'<' +
            'your api key>\')'));
          return;
        }

        if (!task.options.headers) {
          task.options.headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          };
        }
        if (process.env.COMMUNIBASE_API_HOST) {
          task.options.headers.Host = process.env.COMMUNIBASE_API_HOST;
        }

        if (this.key) {
          task.options.headers['x-api-key'] = this.key;
        }
        if (this.token) {
          task.options.headers['x-access-token'] = this.token;
        }
        // not support by fetch spec / whatwg-fetch
        if (task.options.query) {
          task.url += `?${Object.keys(task.options.query).map(
            queryVar => `${encodeURIComponent(queryVar)}=${encodeURIComponent(task.options.query[queryVar])}`,
          ).join('&')}`;
          task.options.query = undefined;
        }

        let success = false;
        Promise.resolve(fetch(task.url, task.options)).then((response) => {
          success = (response.status === 200);
          return response.json();
        }).then((result) => {
          if (success) {
            const deferred = task.deferred;
            let records = result;
            if (result.metadata && result.records) {
              deferred.promise.metadata = result.metadata;
              records = result.records;
            }
            deferred.resolve(records);
            callback();
            return null;
          }
          throw result;
        }).catch(fail);
      },
      8,
    );
  }

  public setServiceUrl(newServiceUrl: string):void {
    if (!newServiceUrl) {
      throw new Error('Cannot set empty service-url');
    }
    this.serviceUrl = newServiceUrl;
    this.serviceUrlIsHttps = (newServiceUrl.indexOf('https') === 0);
  }

  private queueSearch(
    objectType: CommunibaseEntityType,
    selector: {},
    params?: CommunibaseParams,
  ): Promise<CommunibaseDocument[]> {
    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/search`,
      options: {
        method: 'POST',
        body: JSON.stringify(selector),
        query: params,
      },
    });
    return deferred.promise;
  }

  /**
   * Bare boned retrieval by objectIds
   * @returns {Promise}
   */
  private privateGetByIds(
    objectType: CommunibaseEntityType,
    objectIds: string[],
    params?: {},
  ): Promise<CommunibaseDocument[]> {
    return this.queueSearch(
      objectType,
      {
        _id: { $in: objectIds },
      },
      params,
    );
  }

  /**
   * Default object retrieval: should provide cachable objects
   */
  private spoolQueue():void {
    Object.keys(this.getByIdQueue).forEach((objectType) => {
      const deferredsById = this.getByIdQueue[objectType];
      const objectIds = Object.keys(deferredsById);

      this.getByIdQueue[objectType] = {};
      this.privateGetByIds(objectType, objectIds).then(
        (objects) => {
          const objectHash:{ [key: string]: CommunibaseDocument } = objects.reduce(
            (previousValue: { [key: string]: CommunibaseDocument }, object) => {
              previousValue[object._id] = object;
              return previousValue;
            },
            {},
          );
          objectIds.forEach((objectId: string) => {
            if (objectHash[objectId]) {
              deferredsById[objectId].resolve(objectHash[objectId]);
              return;
            }
            deferredsById[objectId].reject(new Error(`${objectId} is not found`));
          });
        },
        (err) => {
          objectIds.forEach((objectId) => {
            deferredsById[objectId].reject(err);
          });
        },
      );
    });
    this.getByIdPrimed = false;
  }

  /**
   * Get a single object by its id
   *
   * @param {string} objectType - E.g. Person
   * @param {string}objectId - E.g. 52259f95dafd757b06002221
   * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
   * @param {string|null} [versionId=null] - optional versionId to retrieve
   * @returns {Promise} - for object: a key/value object with object data
   */
  getById(
    objectType: CommunibaseEntityType,
    objectId: string,
    params?: CommunibaseParams,
    versionId?: string,
  ): Promise<CommunibaseDocument> {
    if (typeof objectId !== 'string' || objectId.length !== 24) {
      return Promise.reject(new Error('Invalid objectId'));
    }

    // not combinable...
    if (versionId || (params && params.fields)) {
      const deferred = defer();
      this.queue.push({
        deferred,
        url: `${this.serviceUrl + objectType}.json/${versionId ?
          `history/${objectId}/${versionId}` :
          `crud/${objectId}`}`,
        options: {
          method: 'GET',
          query: params,
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
  public getByIds(
    objectType: CommunibaseEntityType,
    objectIds: string[],
    params?: CommunibaseParams,
  ):Promise<CommunibaseDocument[]> {
    if (objectIds.length === 0) {
      return Promise.resolve([]);
    }

    // not combinable...
    if (params && params.fields) {
      return this.privateGetByIds(objectType, objectIds, params);
    }

    return Promise.all(
      objectIds.map(objectId => this.getById(objectType, objectId, params).reflect()),
    ).then((inspections) => {
      const result: CommunibaseDocument[] = [];
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
  public getAll(objectType: CommunibaseEntityType, params?: CommunibaseParams):Promise<CommunibaseDocument[]> {
    if (this.cache && !(params && params.fields)) {
      return this.search(objectType, {}, params);
    }

    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/crud`,
      options: {
        method: 'GET',
        query: params,
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
  public getIds(objectType: CommunibaseEntityType, selector?: {}, params?: CommunibaseParams):Promise<string[]> {
    let hash: string;
    let result;

    if (this.cache) {
      hash = JSON.stringify([objectType, selector, params]);
      if (!this.cache.getIdsCaches[objectType]) {
        this.cache.getIdsCaches[objectType] = new lruCache(1000); // 1000 getIds are this.cached, per entityType
      }
      result = this.cache.getIdsCaches[objectType].get(hash);
      if (result) {
        return Promise.resolve(result);
      }
    }

    const resultPromise = this.search(
      objectType,
      selector,
      Object.assign({ fields: '_id' }, params),
    ).then(results => results.map(obj => obj._id));

    if (this.cache) {
      return resultPromise.then((ids) => {
        this.cache.getIdsCaches[objectType].set(hash, ids);
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
  public getId(objectType: CommunibaseEntityType, selector?: {}) : Promise<string> {
    return this.getIds(objectType, selector, { limit: 1 }).then(ids => ids.pop());
  }

  /**
   *
   * @param objectType
   * @param selector - mongodb style
   * @param params
   * @returns {Promise} for objects
   */
  public search(
    objectType: CommunibaseEntityType,
    selector: {},
    params?: CommunibaseParams,
  ): Promise<CommunibaseDocument[]> {
    if (this.cache && !(params && params.fields)) {
      return this.getIds(objectType, selector, params).then(ids => this.getByIds(objectType, ids));
    }

    if (selector && (typeof selector === 'object') && Object.keys(selector).length) {
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
  public update(objectType: CommunibaseEntityType, object: CommunibaseDocument): Promise<CommunibaseDocument> {
    const deferred = defer();
    const operation = ((object._id && (object._id.length > 0)) ? 'PUT' : 'POST');

    if (object._id && this.cache && this.cache.objectCache && this.cache.objectCache[objectType] &&
      this.cache.objectCache[objectType][object._id]) {
      this.cache.objectCache[objectType][object._id] = null;
    }

    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/crud${(operation === 'PUT') ? `/${object._id}` : ''}`,
      options: {
        method: operation,
        body: JSON.stringify(object),
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
  public destroy(objectType: CommunibaseEntityType, objectId: string):Promise<null> {
    const deferred = defer();

    if (this.cache && this.cache.objectCache && this.cache.objectCache[objectType] &&
      this.cache.objectCache[objectType][objectId]) {
      this.cache.objectCache[objectType][objectId] = null;
    }

    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/crud/${objectId}`,
      options: {
        method: 'DELETE',
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
  public undelete(objectType: CommunibaseEntityType, objectId: string):Promise<CommunibaseDocument> {
    const deferred = defer();

    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/history/undelete/${objectId}`,
      options: {
        method: 'POST',
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
  public createReadStream(fileId: string):ReadableStream {
    const request = (this.serviceUrlIsHttps ? httpsRequest : httpRequest);
    const fileStream = new PassThrough();
    const req = request(
      `${this.serviceUrl}File.json/binary/${fileId}?api_key=${this.key}`,
      (res: http.IncomingMessage) => {
        if (res.statusCode === 200) {
          res.pipe(fileStream);
          return;
        }
        fileStream.emit('error', new Error(http.STATUS_CODES[res.statusCode]));
        fileStream.emit('end');
      },
    );
    if (process.env.COMMUNIBASE_API_HOST) {
      req.setHeader('Host', process.env.COMMUNIBASE_API_HOST);
    }
    req.end();
    req.on('error', (err:Error) => {
      fileStream.emit('error', err);
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
  public updateBinary(
    resource:ReadableStream|Buffer|string,
    name:string,
    destinationPath:string,
    id:string,
  ):Promise<CommunibaseDocument> {
    const metaData = {
      path: destinationPath,
    };

    return getResourceBufferPromise(resource).then((buffer:any) => {
      if (id) { // TODO check is valid id? entails extra dependency (mongodb.ObjectID)
        // update File identified by id
        return this.update('File', {
          _id: id,
          filename: name,
          length: buffer.length,
          uploadDate: moment().format(),
          metadata: metaData,
          content: buffer,
        });
      }

      // create a new File
      const deferred = defer();
      const formData:FormData = new FormData();
      let stringOrBlob:string|Blob = buffer;

      // @see https://developer.mozilla.org/en-US/docs/Web/API/FormData/append
      // officially, formdata may contain blobs or strings. node doesn't do blobs, but when polymorphing in a browser we
      // may cast it to one for it to work properly...
      if (typeof window !== 'undefined' && window.Blob) {
        stringOrBlob = new Blob([buffer]);
      }

      formData.append('File', stringOrBlob, name);
      formData.append('metadata', JSON.stringify(metaData));

      this.queue.push({
        deferred,
        url: `${this.serviceUrl}File.json/binary`,
        options: {
          method: 'POST',
          body: formData,
          headers: {
            Accept: 'application/json',
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
  public clone(apiKey: string):Connector {
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
  public getHistory(objectType:CommunibaseEntityType, objectId: string):Promise<CommunibaseVersionInformation[]> {
    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/history/${objectId}`,
      options: {
        method: 'GET',
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
  public historySearch(objectType: CommunibaseEntityType, selector: {}):Promise<CommunibaseVersionInformation[]> {
    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/history/search`,
      options: {
        method: 'POST',
        body: JSON.stringify(selector),
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
  public getByRef(ref: CommunibaseDocumentReference, parentDocument: CommunibaseDocument):Promise<CommunibaseDocument> {
    if (!(ref && ref.rootDocumentEntityType && (ref.rootDocumentId || parentDocument))) {
      return Promise.reject(new Error('Please provide a documentReference object with a type and id'));
    }

    const rootDocumentEntityTypeParts = ref.rootDocumentEntityType.split('.');
    let parentDocumentPromise;
    if (rootDocumentEntityTypeParts[0] !== 'parent') {
      parentDocumentPromise = this.getById(ref.rootDocumentEntityType, ref.rootDocumentId);
    } else {
      parentDocumentPromise = Promise.resolve(parentDocument);
    }

    if (!(ref.path && ref.path.length && ref.path.length > 0)) {
      return parentDocumentPromise;
    }

    /* tslint:disable no-parameter-reassignment */
    return parentDocumentPromise.then((result: CommunibaseDocument) => {
      ref.path.some((pathNibble) => {
        if (result[pathNibble.field]) {
          if (!result[pathNibble.field].some((subDocument:CommunibaseDocument) => {
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
      throw new Error('The referred object within it\'s parent could not be found');
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
  public aggregate(objectType:CommunibaseEntityType, aggregationPipeline:{}[]):Promise<{}[]> {
    if (!aggregationPipeline || !aggregationPipeline.length) {
      return Promise.reject(new Error('Please provide a valid Aggregation Pipeline.'));
    }

    let hash:string;
    if (this.cache) {
      hash = JSON.stringify([objectType, aggregationPipeline]);
      if (!this.cache.aggregateCaches[objectType]) {
        this.cache.aggregateCaches[objectType] = lruCache(1000); // 1000 getIds are this.cached, per entityType
      }
      const result = this.cache.aggregateCaches[objectType].get(hash);
      if (result) {
        return Promise.resolve(result);
      }
    }

    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl + objectType}.json/aggregate`,
      options: {
        method: 'POST',
        body: JSON.stringify(aggregationPipeline),
      },
    });

    const resultPromise = deferred.promise;

    if (this.cache) {
      return resultPromise.then((result) => {
        this.cache.aggregateCaches[objectType].set(hash, result);
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
  public finalizeInvoice(invoiceId:string) : Promise<CommunibaseDocument> {
    const deferred = defer();
    this.queue.push({
      deferred,
      url: `${this.serviceUrl}Invoice.json/finalize/${invoiceId}`,
      options: {
        method: 'POST',
      },
    });
    return deferred.promise;
  }

  /**
   * @param communibaseAdministrationId
   * @param socketServiceUrl
   */
  public enableCache(communibaseAdministrationId: string, socketServiceUrl: string):void {
    this.cache = {
      getIdsCaches: {},
      aggregateCaches: {},
      dirtySock: socketIoClient.connect(socketServiceUrl, { port: '443' }),
      objectCache: {},
      isAvailable(objectType, objectId) {
        return this.cache.objectCache[objectType] && this.cache.objectCache[objectType][objectId];
      },
    };
    this.cache.dirtySock.on('connect', () => {
      this.cache.dirtySock.emit('join', `${communibaseAdministrationId}_dirty`);
    });
    this.cache.dirtySock.on('message', (dirtyness:string) => {
      const dirtyInfo = dirtyness.split('|');
      if (dirtyInfo.length !== 2) {
        winston.warn(`${new Date()}: Got weird dirty sock data? ${dirtyness}`);
        return;
      }
      this.cache.getIdsCaches[dirtyInfo[0]] = null;
      this.cache.aggregateCaches[dirtyInfo[0]] = null;
      if ((dirtyInfo.length === 2) && this.cache.objectCache[dirtyInfo[0]]) {
        this.cache.objectCache[dirtyInfo[0]][dirtyInfo[1]] = null;
      }
    });
  }
}

// Backwards compatibility-ish
export default new Connector(process.env.COMMUNIBASE_KEY);
