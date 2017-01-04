var fs = require('fs');
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

		Object.keys(privateApiKeysWithGroupIds).forEach(function (apiKey) {
			cbcs[apiKey] = cbc.clone(apiKey);
			promises.push(cbcs[apiKey].getById('Group', privateApiKeysWithGroupIds[groupId]));
		});
		Object.keys(privateApiKeysWithGroupIds).forEach(function (apiKey) {
			promises.push(cbcs[apiKey].getById('Group', privateApiKeysWithGroupIds[groupId]));
		});

		Promise.all(promises).then(function () {
			done();
		}, done);
	});
});
