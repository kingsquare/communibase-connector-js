'use strict';
var when, restler, _, async, http, https, stream, Connector;

when = require('when');
restler = require('restler');
_ = require('underscore');
async = require('async');
http = require('http');
https = require('https');
stream = require('stream');

/**
 * Constructor for connector.
 *
 * @param key - The communibase api key
 * @constructor
 */
Connector = function (key) {
	var getByIdQueue, getByIdPrimed, serviceUrl, serviceUrlIsHttps;

	getByIdQueue = {};
	getByIdPrimed = false;
	serviceUrl = 'https://api.communibase.nl/0.1/';
	serviceUrlIsHttps = true;

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

		fail = function (errorData) {
			task.deferred.reject(errorData);
			callback();
		};

		if (!key) {
			fail(new Error('Missing key for Communibase Connector: please set COMMUNIBASE_KEY environment' +
					' variable, or spawn a new instance using require(\'communibaseConnector\').clone(\'<' +
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
	 * Bare boned retrieval by objectId
	 * @returns {Promise}
	 */
	this._getById = function (objectType, objectId, params, versionId) {
		var deferred = when.defer();
		this.queue.push({
			deferred: deferred,
			method: 'get',
			url: serviceUrl + objectType + '.json/' + (versionId
					? 'history/' + objectId + '/' + versionId
					: 'crud/' + objectId),
			options: {
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
		return this.search(objectType, {
			_id: { $in: objectIds }
		}, params);
	};

	this.getByIdTask = function () {
		var self = this;
		_.each(getByIdQueue, function (deferredsById, objectType) {
			var objectIds = _.keys(deferredsById);
			getByIdQueue[objectType] = {};

			if (objectIds.length === 1) {
				self._getById(objectType, objectIds[0]).then(
						function (object) {
							deferredsById[object._id].resolve(object);
						},
						function (error) {
							deferredsById[objectIds[0]].reject(error);
						}
				);
			}

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

		if (!versionId && (!params || !params.fields)) {
			//since we are not requesting a specific version or fields, we may combine the request..?
			if (getByIdQueue[objectType] === undefined) {
				getByIdQueue[objectType] = {};
			}
			if (getByIdQueue[objectType][objectId]) {
				//requested twice?
				return getByIdQueue[objectType][objectId].promise;
			}

			getByIdQueue[objectType][objectId] = when.defer();
			if (!getByIdPrimed) {
				process.nextTick(function () {
					self.getByIdTask();
				});
				getByIdPrimed = true;
			}
			return getByIdQueue[objectType][objectId].promise;
		}

		return this._getById(objectType, objectId, params, versionId);
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

		if (!params || !params.fields) {
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
		}

		return this._getByIds(objectType, objectIds, params);
	};

	/**
	 * Get all objects of a certain type
	 *
	 * @param {string} objectType - E.g. Person
	 * @param {object} [params={}] - key/value store for extra arguments like fields, limit, page and/or sort
	 * @returns {Promise} - for array of key/value objects
	 */
	this.getAll = function (objectType, params) {
		var deferred = when.defer();
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
		var queryParams = { fields: '_id' };
		return this.search(objectType, selector, _.extend(queryParams, params)).then(function (result) {
			return _.pluck(result, '_id');
		});
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
	 * @returns promise for objects
	 */
	this.search = function (objectType, selector, params) {
		var deferred;

		if (_.isEmpty(selector)) {
			return this.getAll(objectType, params);
		}

		deferred = when.defer();
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
	 * This will save a document in Communibase. When a _id-field is found, this document will be updated
	 *
	 * @param objectType
	 * @param object - the to-be-saved object data
	 * @returns promise for object (the created or updated object)
	 */
	this.update = function (objectType, object) {
		var deferred = when.defer(), operation = ((object._id && (object._id.length > 0)) ? 'put' : 'post');

		this.queue.push({
			deferred: deferred,
			method: operation,
			url: serviceUrl + objectType + '.json/crud' + ((operation === 'put')
					? '/' + object._id
					: ''),
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

		this.queue.push({
			deferred: deferred,
			method: 'del',
			url: serviceUrl + objectType + '.json/crud/' + objectId
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
	 * Get a single object by a ref-string
	 *
	 * @param {string} ref - E.g.
	 * @param {object} parentDocument
	 * @return {Promise} for referred object
	 */
	this.getByRef = function (ref, parentDocument) {
		var refParts, entityParts, parentDocumentPromise;

		if (!ref) {
			return when.reject(new Error('An empty ref cannot be resolved'));
		}

		refParts =  ref.split('.');
		if (refParts[0] !== 'parent') {
			entityParts = refParts[0].split('|');
			parentDocumentPromise = this.getById(entityParts[0], entityParts[1]);
		} else {
			parentDocumentPromise = when(parentDocument);
		}

		if (!refParts[1]) {
			return parentDocumentPromise;
		}

		return parentDocumentPromise.then(function (parentDocument) {
			var propertyParts = refParts[1].split('|'), result = null;
			_.some(parentDocument[propertyParts[0]], function (subDocument) {
				if (subDocument._id === propertyParts[1]) {
					result = subDocument;
					return true;
				}
				return false;
			});

			if (result) {
				return result;
			}
			return when.reject(new Error('The referred object within it\'s parent could not be found'));
		});
	};
};

module.exports = new Connector(process.env.COMMUNIBASE_KEY);