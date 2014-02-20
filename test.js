/*global describe: false, it: false */

'use strict';

//Can not perform test, key exists
if (process.env.COMMUNIBASE_KEY) {
	console.log('Deleting ENV key: tests should be run without one...');
	delete process.env.COMMUNIBASE_KEY;
}

var cbc = require('./index.js'), when = require('when'), assert = require('assert'), ids, newHenk;

describe('Connector', function () {
	describe('key handling', function () {
		it('should throw errors when no key is configured', function (done) {
			cbc.getAll('EntityType').then(function () {
				done(new Error('Got response without configured key'));
			}, function () {
				done();
			});
		});

		it('should be able to construct a clone with a different key', function (done) {
			cbc = cbc.clone('Btd4tz7WCaPI7zbUUaY6PxF4YePEN');
			cbc.getAll('EntityType').then(function () {
				done();
			}, function (err) {
				done(err);
			});
		});
	});

	describe('getAll', function () {
		it('should get all EntityTypes', function (done) {
			cbc.getAll('EntityType').then(function (entityTypes) {
				assert.equal(entityTypes && (entityTypes.length > 0), true);
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('getIds', function () {
		it('should get an array of ids', function (done) {
			cbc.getIds('EntityType', { _id: { $exists: true }}).then(function (entityTypeIds) {
				ids = entityTypeIds;
				assert.equal(entityTypeIds.length > 0, true);
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('getId', function () {
		it('should get an id', function (done) {
			cbc.getId('EntityType').then(function (entityTypeId) {
				assert.equal(entityTypeId.length > 0, true);
				done();
			}, function (error) {
				done(error);
			});
		});

		it('should return undefined when no id is available', function (done) {
			cbc.getId('EntityType', { _id: { $exists: false }}).then(function (entityTypeId) {
				assert.equal(entityTypeId, undefined);
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('getById', function () {
		it('should get an object by its id', function (done) {
			cbc.getById('EntityType', ids.pop()).then(function (entityType) {
				assert.equal((entityType._id !== undefined), true);
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('getByIds', function () {
		it('should get data by ids', function (done) {
			cbc.getByIds('EntityType', ids).then(function (entityTypes) {
				assert.equal(entityTypes.length > 0, true);
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('update', function () {
		it('should not create an invalid document e.g. a person without lastname', function (done) {
			cbc.update('Person', { firstName: 'Henk' }).then(function () {
				done(new Error('Could create an invalid document'));
			}, function () { //error
				done();
			});
		});

		it('should create a valid person', function (done) {
			cbc.update('Person', {
				firstName: 'Henk',
				registeredDate: new Date()
			}).then(function (result) {
				assert.equal((result._id === undefined), false);
				newHenk = result;
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('getReadStream', function () {
		it('should produce a readable stream', function (done) {
			var stream = cbc.createReadStream('52498dbaf4277fa813000021'), data;
			stream.on('data', function (chunk) {
				data += chunk;
			});
			stream.on('end', function () {
				assert.equal(data.length, 478);
				done();
			});
		});

		it('should produce a stream that throws an error if any', function (done) {
			var stream = cbc.createReadStream('12345'), gotError = false;
			stream.on('error', function () { //err?
				gotError = true;
			});
			stream.on('end', function () {
				assert.equal(gotError, true);
				done();
			});
		});
	});

	describe('destroy', function () {
		it('should delete something e.g. a person', function (done) {
			cbc.destroy('Person', newHenk._id).then(function () {
				done();
			}, function (error) {
				done(error);
			});
		});
	});

	describe('queue handling', function () {
		it('should handle/queue a lot of requests properly', function (done) {
			var i, promise, resultPromises = [], assertEqual = function (result) {
				assert.equal(result.length, 1);
			};
			for (i = 0; i < 100; i += 1) {
				promise = cbc.search('EntityType', { "_id": ids[0] }).then(assertEqual);
				resultPromises.push(promise);
			}

			when.all(resultPromises).then(function (result) {
				assert.equal(result.length, 100);
				done();
			});
		});
	});

	describe('metadata handling', function () {
		it('works', function (done) {
			var promise;
			promise = cbc.search('EntityType', { _id: { $exists: true }}, {
				limit: 1,
				includeMetadata: true
			});
			promise.then(function () {
				assert.equal((promise.metadata.total > 1), true);
				done();
			});
		});

		it('does not break on a regular result-object containing a property metadata (e.g. File)', function (done) {
			cbc.getId('File', { metadata: { $exists: true }}).then(function (fileId) {
				return cbc.getById('File', fileId).then(function (file) {
					assert.equal((file === undefined), false);
					done();
				}, function (err) {
					done(err);
				});
			}, function (err) {
				done(err);
			});
		});
	});
});
