var fs = require('fs');
var when = require('when');
var _ = require('lodash');
describe('Async connectors', function (done) {
	this.timeout(10000);

	try {
		privateApiKeysWithGroupIds = JSON.parse(fs.readFileSync('./privateApiKeysWithGroupIds.json'));

	} catch (e) {
		console.log('** privateApiKeysWithGroupIds.json not found, skipping test **');
		return;
	}

	var cbc = require('../index.js');
	it('should work with multiple connectors in multiple administratations', function (done) {
		var promises = [], cbcs = {};

		_.each(privateApiKeysWithGroupIds, function (groupId, apiKey) {
			cbcs[apiKey] = cbc.clone(apiKey);
			promises.push(cbcs[apiKey].getById('Group', groupId));
		});
		_.each(privateApiKeysWithGroupIds, function (groupId, apiKey) {
			promises.push(cbcs[apiKey].getById('Group', groupId));
		});

		when.all(promises).then(function () {
			done();
		}, done);
	});
});