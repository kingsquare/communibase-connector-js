/// <reference types="node" />
import * as Promise from "bluebird";
import ReadableStream = NodeJS.ReadableStream;
export interface IDeferred {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    promise: Promise<any> & {
        metadata?: any;
    };
}
export declare type CommunibaseEntityType = "Person" | "Membership" | "Event" | "Invoice" | "Contact" | "Debtor" | "File" | string;
export interface ICommunibaseDocument {
    _id?: string;
    [prop: string]: any;
}
export interface ICommunibaseDocumentReference {
    rootDocumentEntityType: CommunibaseEntityType;
    rootDocumentId: string;
    path: Array<{
        field: string;
        objectId: string;
    }>;
}
export interface ICommunibaseVersionInformation {
    _id: string;
    updatedAt: string;
    updatedBy: string;
}
export interface ICommunibaseParams {
    fields?: string;
    limit?: number;
    page?: number;
    sort?: string;
    includeMetadata?: boolean;
    dir?: "ASC" | "DESC";
    deleted?: boolean;
}
/**
 * Constructor for connector.
 *
 * @param key - The communibase api key
 * @constructor
 */
export declare class Connector {
    private getByIdQueue;
    private getByIdPrimed;
    private key?;
    private token;
    private serviceUrl;
    private serviceUrlIsHttps;
    private queue;
    private cache?;
    constructor(key?: string);
    setServiceUrl(newServiceUrl: string): void;
    /**
     * Get a single object by its id
     *
     * @param {string} objectType - E.g. Person
     * @param {string}objectId - E.g. 52259f95dafd757b06002221
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @param {string|null} [versionId=null] - optional versionId to retrieve
     * @returns {Promise} - for object: a key/value object with object data
     */
    getById<T extends ICommunibaseDocument = ICommunibaseDocument>(objectType: CommunibaseEntityType, objectId: string, params?: ICommunibaseParams, versionId?: string): Promise<T>;
    /**
     * Get an array of objects by their ids
     * If one or more entries are found, they are returned as an array of values
     *
     * @param {string} objectType - E.g. Person
     * @param {Array} objectIds - objectIds - E.g. ['52259f95dafd757b06002221']
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getByIds<T extends ICommunibaseDocument = ICommunibaseDocument>(objectType: CommunibaseEntityType, objectIds: string[], params?: ICommunibaseParams): Promise<T[]>;
    /**
     * Get all objects of a certain type
     *
     * @param {string} objectType - E.g. Person
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getAll<T extends ICommunibaseDocument = ICommunibaseDocument>(objectType: CommunibaseEntityType, params?: ICommunibaseParams): Promise<T[]>;
    /**
     * Get result objectIds of a certain search
     *
     * @param {string} objectType - E.g. Person
     * @param {object} selector - { firstName: "Henk" }
     * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
     * @returns {Promise} - for array of key/value objects
     */
    getIds(objectType: CommunibaseEntityType, selector?: {}, params?: ICommunibaseParams): Promise<string[]>;
    /**
     * Get the id of an object based on a search
     *
     * @param {string} objectType - E.g. Person
     * @param {object} selector - { firstName: "Henk" }
     * @returns {Promise} - for a string OR undefined if not found
     */
    getId(objectType: CommunibaseEntityType, selector?: {}): Promise<string | null>;
    /**
     *
     * @param objectType
     * @param selector - mongodb style
     * @param params
     * @returns {Promise} for objects
     */
    search<T extends ICommunibaseDocument = ICommunibaseDocument>(objectType: CommunibaseEntityType, selector: {}, params?: ICommunibaseParams): Promise<T[]>;
    /**
     * This will save a document in Communibase. When a _id-field is found, this document will be updated
     *
     * @param objectType
     * @param object - the to-be-saved object data
     * @returns promise for object (the created or updated object)
     */
    update<T extends ICommunibaseDocument = ICommunibaseDocument>(objectType: CommunibaseEntityType, object: T): Promise<T>;
    /**
     * Delete something from Communibase
     *
     * @param objectType
     * @param objectId
     * @returns promise (for null)
     */
    destroy(objectType: CommunibaseEntityType, objectId: string): Promise<null>;
    /**
     * Undelete something from Communibase
     *
     * @param objectType
     * @param objectId
     * @returns promise (for null)
     */
    undelete(objectType: CommunibaseEntityType, objectId: string): Promise<ICommunibaseDocument>;
    /**
     * Get a Promise for a Read stream for a File stored in Communibase
     *
     * @param fileId
     * @returns {Stream} see http://nodejs.org/api/stream.html#stream_stream
     */
    createReadStream(fileId: string): ReadableStream;
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
    updateBinary(resource: ReadableStream | Buffer | string, name: string, destinationPath: string, id?: string): Promise<ICommunibaseDocument>;
    /**
     * Get a new Communibase Connector, may be with a different API key
     *
     * @param apiKey
     * @returns {Connector}
     */
    clone(apiKey: string): Connector;
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
    getHistory(objectType: CommunibaseEntityType, objectId: string): Promise<ICommunibaseVersionInformation[]>;
    /**
     *
     * @param {string} objectType
     * @param {Object} selector
     * @returns promise for VersionInformation[]
     */
    historySearch(objectType: CommunibaseEntityType, selector: {}): Promise<ICommunibaseVersionInformation[]>;
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
    getByRef(ref: ICommunibaseDocumentReference, parentDocument: ICommunibaseDocument): Promise<ICommunibaseDocument>;
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
    aggregate(objectType: CommunibaseEntityType, aggregationPipeline: Array<{}>): Promise<Array<{}>>;
    /**
     * Finalize an invoice by its ID
     *
     * @param invoiceId
     * @returns {*}
     */
    finalizeInvoice(invoiceId: string): Promise<ICommunibaseDocument>;
    /**
     * @param communibaseAdministrationId
     * @param socketServiceUrl
     */
    enableCache(communibaseAdministrationId: string, socketServiceUrl: string): void;
    private queueSearch;
    /**
     * Bare boned retrieval by objectIds
     * @returns {Promise}
     */
    private privateGetByIds;
    /**
     * Default object retrieval: should provide cachable objects
     */
    private spoolQueue;
}
declare const _default: Connector;
export default _default;
