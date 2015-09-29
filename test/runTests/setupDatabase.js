/*global Promise:true */

'use strict';

var Promise = require('bluebird');
var mongodb = require('mongodb');
var MongoClient = Promise.promisifyAll(mongodb.MongoClient);
var BSONStream = require('bson-stream');
var Db = mongodb.Db;
var Server = mongodb.Server;
var url = require('url');
var fs = require('fs');
var cbc = require('../../index.js');

function getDropDbPromise(uri) {
	var parsedUrl = url.parse(uri);
	var db = new Db(parsedUrl.path.substr(1), new Server(parsedUrl.hostname, parsedUrl.port || 27017), { safe: false });
	db = Promise.promisifyAll(db);
	return db.openAsync().then(function (db) {
		return db.dropDatabase();
	}).then(function () {
		db.close();
	});
}

function addSpectialAttributes(entityType) {
	if (entityType.title !== 'Person') {
		return entityType;
	}

	entityType.attributes.push({
		title: 'sectors',
		isCore: false,
		isRequired: false,
		type: 'Array',
		description: 'something with sectors',
		items: 'string',
		allowableValues: {
			valueType: 'List',
			values: ['a', 'b', 'c', 'd', 'e']
		}
	});

	return entityType;
}

function importBsonEntityTypes(bsonFileLocation, dbUri) {
	return new Promise(function (resolve, reject) {
		var bson = new BSONStream();
		fs.createReadStream(bsonFileLocation).pipe(bson);
		var toBeSavedEntityTypes = [];

		bson.on('data', function (entityType) {
			return toBeSavedEntityTypes.push(addSpectialAttributes(entityType));
		});

		bson.on('end', function () {
			MongoClient.connectAsync(dbUri).then(function (administrationConnection) {
				return Promise.promisifyAll(administrationConnection.collection('EntityType')).
					insertAsync(toBeSavedEntityTypes).then(function () {
						administrationConnection.close();
					});
			}).then(resolve, reject);
		});
	});
}

module.exports = function() {
	var adminMongooseConnection = require(
		__dirname + '/../../node_modules/Communibase/inc/mongeese/createAdminMongoose.js')(
		process.env.MASTER_DB_URI
	);

	var adminMongooseConnectionReadyDeferred = new Promise(function (resolve) {
		adminMongooseConnection.once('open', resolve);
	});

	return Promise.all([
		adminMongooseConnectionReadyDeferred,
		getDropDbPromise(process.env.MASTER_DB_URI),
		getDropDbPromise(process.env.TEST_ADMINISTRATION_DB_URI)
	]).then(function () {
		console.log('Saving new master key');

		return Promise.promisifyAll(adminMongooseConnection.models.ApiKey.collection).insertAsync({
			"administrationId": process.env.MASTER_ADMINISTRATION_ID,
			"key": process.env.MASTER_APIKEY,
			"description": "The API unittest master test key",
			"email": "unittest@kingsquare.nl",
			"apiEndpoints": [],
			"propertyAccessDescriptions": []
		});
	}).then(function () {
		console.log('Saving new adminisitration');

		return adminMongooseConnection.models.Administration.create({
			"title": 'Unittest administration',
			"dbUri": process.env.TEST_ADMINISTRATION_DB_URI,
			"type": "Kingsquare"
		}).then(function (administration) {
			process.env.TEST_ADMINISTRATION_ID = administration._id;
			return Promise.resolve(administration._id);
		});
	}).then(function (administrationId) {
		console.log('Saving new administration key!');
		return adminMongooseConnection.models.ApiKey.create({
			"administrationId": administrationId,
			"key": process.env.COMMUNIBASE_KEY,
			"description": "The API unittest administration test key",
			"email": "unittest@kingsquare.nl",
			"apiEndpoints": [],
			"propertyAccessDescriptions": []
		});
	}).then(function () {
		adminMongooseConnection.close();
	}).then(function () {
		console.log('Inserting administration entitytypes...');
		return importBsonEntityTypes(__dirname +
			'/../../node_modules/Communibase/test/resources/dump/blueprint/EntityType.bson',
			process.env.TEST_ADMINISTRATION_DB_URI);
	});
};