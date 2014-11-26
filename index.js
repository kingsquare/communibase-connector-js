'use strict';
var when, restler, _, async, http, https, stream, Connector, io, LRU;

when = require('when');
restler = require('restler');
_ = require('lodash');
async = require('async');
http = require('http');
https = require('https');
stream = require('stream');
io = require('socket.io-client');
LRU = require("lru-cache");

function CommunibaseError(data, task) {
	this.name = "CommunibaseError";
	this.code = (data.code || 500);
	this.message = (data.message || "");
	this.errors = (data.errors || {});
	this.debugInfo = null;

	if ((_.size(this.errors) === 0) && task) {
		//try and make this a bit more debuggable
		this.debugInfo = {
			method: task.method,
			url: task.url,
			headers: (task.options ? task.options.headers : null),
			data: ((task.options && task.options.data && task.options.toString) ? task.options.data.toString() : '')
		}
	}

	Error.captureStackTrace(this, CommunibaseError);
}

CommunibaseError.prototype = Error.prototype;
/**
 * Constructor for connector.
 *
 * @param key - The communibase api key
 * @constructor
 */
Connector = function (key) {
	var getByIdQueue, getByIdPrimed, serviceUrl, serviceUrlIsHttps, cache;

	getByIdQueue = {};
	getByIdPrimed = false;
	serviceUrl = process.env.COMMUNIBASE_API_URL || 'https://api.communibase.nl/0.1/';
	serviceUrlIsHttps = true;
	cache = null;

	this.setServiceUrl = function (newServiceUrl) {
		serviceUrl = newServiceUrl;
		serviceUrlIsHttps = (newServiceUrl.indexOf('https') === 0);
	};

	this.queue = async.queue(function (task, callback) {
		var success, fail;

		success = function (result) {
			var deferred = task.deferred;
			if (result.metadata && result.records) {
				deferred.promise.metadata = result.metadata;
				deferred.resolve(result.records);
				callback();
				return;
			}
			deferred.resolve(result);
			callback();
		};

		fail = function (error) {
			if (!(error instanceof Error)) {
				error = new CommunibaseError(error, task);
			}
			task.deferred.reject(error);
			callback();
		};

		if (!key) {
			fail(new Error('Missing key for Communibase Connector: please set COMMUNIBASE_KEY environment' +
					' variable, or spawn a new instance using require(\'communibase-connector-js\').clone(\'<' +
					'your api key>\')'));
			return;
		}

		if (!task.options) {
			task.options = {};
		}
		if (!task.options.headers) {
			task.options.headers = {};
		}
		task.options.headers['x-api-key'] = key;
		restler[task.method](task.url, task.options).on('success', success).on('fail', fail).on('error', fail);
	}, 8);

	/**
	 *
	 * Bare boned search
	 * @returns {Promise}
	 *
	 ***/
	this._search = function (objectType, selector, params) {
		var deferred = when.defer();
		this.queue.push({
			deferred: deferred,
			method: 'post',
			url: serviceUrl + objectType + '.json/search',
			options: {
				headers: {
					'content-type': 'application/json'
				},
				data: JSON.stringify(selector),
				query: params
			}
		});
		return deferred.promise;
	};


	/**
	 * Bare boned retrieval by objectIds
	 * @returns {Promise}
	 */
	this._getByIds = function (objectType, objectIds, params) {
		return this._search(objectType, {
			_id: { $in: objectIds }
		}, params);
	};

	/**
	 * Default object retrieval: should provide cachable objects
	 */
	this.spoolQueue = function () {
		var self = this;
		_.each(getByIdQueue, function (deferredsById, objectType) {
			var objectIds = _.keys(deferredsById);
			getByIdQueue[objectType] = {};

			self._getByIds(objectType, objectIds).then(
				function (objects) {
					var objectHash = _.indexBy(objects, '_id');
					_.each(objectIds, function (objectId) {
						if (objectHash[objectId]) {
							deferredsById[objectId].resolve(objectHash[objectId]);
							return;
						}
						deferredsById[objectId].reject(new Error(objectId + ' is not found'));
					});
				},
				function (err) {
					_.each(objectIds, function (objectId) {
						deferredsById[objectId].reject(err);
					});
				}
			);
		});
		getByIdPrimed = false;
	};

	/**
	 * Get a single object by its id
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {string}objectId - E.g. 52259f95dafd757b06002221
	 * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
	 * @param {string|null} [versionId=null] - optional versionId to retrieve
	 * @returns {Promise} - for object: a key/value object with object data
	 */
	this.getById = function (objectType, objectId, params, versionId) {
		var self = this;
		if (!_.isString(objectId)) {
			return when.reject(new Error('Invalid objectId'));
		}

		// not combinable...
		if (versionId || (params && params.fields)) {
			var deferred = when.defer();
			this.queue.push({
				deferred: deferred,
				method: 'get',
				url: serviceUrl + objectType + '.json/' + (versionId ?
						'history/' + objectId + '/' + versionId :
						'crud/' + objectId),
				options: {
					query: params
				}
			});
			return deferred.promise;
		}

		//cached?
		if (cache && cache.isAvailable(objectType, objectId)) {
			return cache.objectCache[objectType][objectId];
		}

		//since we are not requesting a specific version or fields, we may combine the request..?
		if (getByIdQueue[objectType] === undefined) {
			getByIdQueue[objectType] = {};
		}

		if (getByIdQueue[objectType][objectId]) {
			//requested twice?
			return getByIdQueue[objectType][objectId].promise;
		}

		getByIdQueue[objectType][objectId] = when.defer();

		if (cache) {
			if (cache.objectCache[objectType] === undefined) {
				cache.objectCache[objectType] = {};
			}
			cache.objectCache[objectType][objectId] = getByIdQueue[objectType][objectId].promise;
		}

		if (!getByIdPrimed) {
			process.nextTick(function () {
				self.spoolQueue();
			});
			getByIdPrimed = true;
		}
		return getByIdQueue[objectType][objectId].promise;
	};

	/**
	 * Get an array of objects by their ids
	 * If one or more entries are found, they are returned as an array of values
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {Array} objectIds - objectIds - E.g. ['52259f95dafd757b06002221']
	 * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
	 * @returns {Promise} - for array of key/value objects
	 */
	this.getByIds = function (objectType, objectIds, params) {
		var promises, self;
		if (objectIds.length === 0) {
			return when([]);
		}

		// not combinable...
		if (params && params.fields) {
			return this._getByIds(objectType, objectIds, params);
		}

		promises = [];
		self = this;
		_.each(objectIds, function (objectId) {
			promises.push(self.getById(objectType, objectId, params));
		});
		return when.settle(promises).then(function (descriptors) {
			var result = [], error = null;
			_.each(descriptors, function (d) {
				if (d.state === 'rejected') {
					error = d.reason;
					return;
				}
				result.push(d.value);
			});
			if (result.length) {
				return result;
			}
			return when.reject(error);
		});
	};

	/**
	 * Get all objects of a certain type
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
	 * @returns {Promise} - for array of key/value objects
	 */
	this.getAll = function (objectType, params) {
		var deferred;

		if (cache && !(params && params.fields)) {
			return this.search(objectType, {}, params);
		}

		deferred = when.defer();
		this.queue.push({
			deferred: deferred,
			method: 'get',
			url: serviceUrl + objectType + '.json/crud',
			options: {
				query: params
			}
		});
		return deferred.promise;
	};

	/**
	 * Get result objectIds of a certain search
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {object} selector - { firstName: "Henk" }
	 * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
	 * @returns {Promise} - for array of key/value objects
	 */
	this.getIds = function (objectType, selector, params) {
		var hash, result;

		if (cache) {
			hash = JSON.stringify(arguments);
			if (!cache.getIdsCaches[objectType]) {
				cache.getIdsCaches[objectType] = LRU(1000); // 1000 getIds are cached, per entityType
			}
			result = cache.getIdsCaches[objectType].get(hash);
			if (result) {
				return when(result);
			}
		}

		result = this.search(objectType, selector, _.extend({ fields: '_id' }, params)).then(function (result) {
			return _.pluck(result, '_id');
		});

		if (cache) {
			return result.then(function (ids) {
				cache.getIdsCaches[objectType].set(hash, ids);
				return ids;
			});
		}

		return result;
	};

	/**
	 * Get the id of an object based on a search
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {object} selector - { firstName: "Henk" }
	 * @returns {Promise} - for a string OR undefined if not found
	 */
	this.getId = function (objectType, selector) {
		return this.getIds(objectType, selector, { limit: 1 }).then(function (ids) {
			return ids.pop();
		});
	};

	/**
	 *
	 * @param objectType
	 * @param selector - mongodb style
	 * @param params
	 * @returns {Promise} for objects
	 */
	this.search = function (objectType, selector, params) {
		if (cache && !(params && params.fields)) {
			var self = this;
			return this.getIds(objectType, selector, params).then(function (ids) {
				return self.getByIds(objectType, ids);
			});
		}

		if (_.isEmpty(selector)) {
			return this.getAll(objectType, params);
		}

		return this._search(objectType, selector, params);
	};

	/**
	 * This will save a document in Communibase. When a _id-field is found, this document will be updated
	 *
	 * @param objectType
	 * @param object - the to-be-saved object data
	 * @returns promise for object (the created or updated object)
	 */
	this.update = function (objectType, object) {
		var deferred = when.defer(), operation = ((object._id && (object._id.length > 0)) ? 'put' : 'post');

		if (object['_id'] && cache && cache.objectCache && cache.objectCache[objectType] &&
				cache.objectCache[objectType][object['_id']])  {
			cache.objectCache[objectType][object['_id']] = null;
		}

		this.queue.push({
			deferred: deferred,
			method: operation,
			url: serviceUrl + objectType + '.json/crud' + ((operation === 'put') ? '/' + object._id  : ''),
			options: {
				headers: {
					'content-type': 'application/json'
				},
				data: JSON.stringify(object)
			}
		});

		return deferred.promise;
	};

	/**
	 * Delete something from Communibase
	 *
	 * @param objectType
	 * @param objectId
	 * @returns promise (for null)
	 */
	this.destroy = function (objectType, objectId) {
		var deferred = when.defer();

		if (cache && cache.objectCache && cache.objectCache[objectType] && cache.objectCache[objectType][objectId])  {
			cache.objectCache[objectType][objectId] = null;
		}

		this.queue.push({
			deferred: deferred,
			method: 'del',
			url: serviceUrl + objectType + '.json/crud/' + objectId
		});

		return deferred.promise;
	};

	/**
	 * Undelete something from Communibase
	 *
	 * @param objectType
	 * @param objectId
	 * @returns promise (for null)
	 */
	this.undelete = function (objectType, objectId) {
		var deferred = when.defer();

		this.queue.push({
			deferred: deferred,
			method: 'post',
			url: serviceUrl + objectType + '.json/history/undelete/' + objectId
		});

		return deferred.promise;
	};

	/**
	 * Get a Promise for a Read stream for a File stored in Communibase
	 *
	 * @param fileId
	 * @returns {Stream} see http://nodejs.org/api/stream.html#stream_stream
	 */
	this.createReadStream = function (fileId) {
		var requestClient = https, req, fileStream = stream.PassThrough();
		if (!serviceUrlIsHttps) {
			requestClient = http;
		}
		req = requestClient.request(serviceUrl + 'File.json/binary/' + fileId + '?api_key=' + key, function (res) {
			if (res.statusCode === 200) {
				res.pipe(fileStream);
				return;
			}
			fileStream.emit('error', new Error(http.STATUS_CODES[res.statusCode]));
			fileStream.emit('end');
		});
		req.end();
		req.on('error', function (err) {
			fileStream.emit('error', err);
		});
		return fileStream;
	};

	/**
	 * Get a new Communibase Connector, may be with a different API key
	 *
	 * @param apiKey
	 * @returns {Connector}
	 */
	this.clone = function (apiKey) {
		return new Connector(apiKey);
	};

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
	this.getHistory = function (objectType, objectId) {
		var deferred = when.defer();
		this.queue.push({
			deferred: deferred,
			method: 'get',
			url: serviceUrl + objectType + '.json/history/' + objectId
		});
		return deferred.promise;
	};

	/**
	 * Get a single object by a DocumentReference-object. A DocumentReference object looks like
	 * {
	 *	rootDocumentId: '524aca8947bd91000600000c',
	 *	rootDocumentEntityType: 'Person',
	 *	path: [
	 *		{
	 *			field: 'addresses',
	 *			objectId: '53440792463cda7161000003'
	 *		}, ...
	 *	]
	 * }
	 *
	 * @param {object} ref - DocumentReference style, see above
	 * @param {object} parentDocument
	 * @return {Promise} for referred object
	 */
	this.getByRef = function (ref, parentDocument) {
		var rootDocumentEntityTypeParts, parentDocumentPromise;

		if (!(ref && ref.rootDocumentEntityType && ref.rootDocumentId)) {
			return when.reject(new Error('Please provide a documentReference object with a type and id'));
		}

		rootDocumentEntityTypeParts =  ref.rootDocumentEntityType.split('.');
		if (rootDocumentEntityTypeParts[0] !== 'parent') {
			parentDocumentPromise = this.getById(ref.rootDocumentEntityType, ref.rootDocumentId);
		} else {
			parentDocumentPromise = when(parentDocument);
		}

		if (!(ref.path && ref.path.length && ref.path.length > 0)) {
			return parentDocumentPromise;
		}

		return parentDocumentPromise.then(function (result) {
			_.some(ref.path, function (pathNibble) {
				if (result[pathNibble.field]) {
					if (!_.some(result[pathNibble.field], function (subDocument) {
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
			return when.reject(new Error('The referred object within it\'s parent could not be found'));
		});
	};

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
	 *
	 */
	this.aggregate = function (objectType, aggregationPipeline) {
		var deferred, hash, result;
		if (!_.isArray(aggregationPipeline) || aggregationPipeline.length === 0)  {
			return when.reject(new Error('Please provide a valid Aggregation Pipeline.'));
		}

		if (cache) {
			hash = JSON.stringify(arguments);
			if (!cache.aggregateCaches[objectType]) {
				cache.aggregateCaches[objectType] = LRU(1000); // 1000 getIds are cached, per entityType
			}
			result = cache.aggregateCaches[objectType].get(hash);
			if (result) {
				return when(result);
			}
		}

		deferred = when.defer();
		this.queue.push({
			deferred: deferred,
			method: 'post',
			url: serviceUrl + objectType + '.json/aggregate',
			options: {
				headers: {
					'content-type': 'application/json'
				},
				data: JSON.stringify(aggregationPipeline)
			}
		});

		result = deferred.promise;

		if (cache) {
			return result.then(function (result) {
				cache.aggregateCaches[objectType].set(hash, result);
				return result;
			});
		}

		return result;
	};

	this.enableCache = function (communibaseAdministrationId, socketServiceUrl) {
		cache = {
			getIdsCaches: {},
			aggregateCaches: {},
			dirtySock: io.connect(socketServiceUrl, { port: 443 }),
			objectCache: {},
			isAvailable: function (objectType, objectId) {
				return cache.objectCache[objectType] && cache.objectCache[objectType][objectId];
			}
		};

		cache.dirtySock.on('connect', function () {
			cache.dirtySock.emit('join', communibaseAdministrationId + '_dirty');
		});
		cache.dirtySock.on('message', function (dirtyness) {
			var dirtyInfo = dirtyness.split('|');
			if (dirtyInfo.length !== 2) {
				console.log(new Date() + ': Got weird dirty sock data? ' + dirtyness);
				return;
			}
			cache.getIdsCaches[dirtyInfo[0]] = null;
			cache.aggregateCaches[dirtyInfo[0]] = null;
			if ((dirtyInfo.length === 2) && cache.objectCache[dirtyInfo[0]]) {
				cache.objectCache[dirtyInfo[0]][dirtyInfo[1]] = null;
			}
		});
	}
};

Connector.prototype.Error = CommunibaseError;
module.exports = new Connector(process.env.COMMUNIBASE_KEY);