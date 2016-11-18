var fs = require('fs');
var _ = require('lodash');
var Promise = require('bluebird');

describe('Async connectors', function (done) {
	this.timeout(10000);

	try {
		privateApiKeysWithGroupIds = JSON.parse(fs.readFileSync('./privateApiKeysWithGroupIds.json'));
	} catch (e) {
		console.log('** privateApiKeysWithGroupIds.json not found, skipping test **');
		return;
	}

	it('should work with multiple connectors in multiple administratations', function (done) {
		var cbc = require('../src/index.js');
		var promises = [], cbcs = {};

		_.each(privateApiKeysWithGroupIds, function (groupId, apiKey) {
			cbcs[apiKey] = cbc.clone(apiKey);
			promises.push(cbcs[apiKey].getById('Group', groupId));
		});
		_.each(privateApiKeysWithGroupIds, function (groupId, apiKey) {
			promises.push(cbcs[apiKey].getById('Group', groupId));
		});

		Promise.all(promises).then(function () {
			done();
		}, done);
	});
});