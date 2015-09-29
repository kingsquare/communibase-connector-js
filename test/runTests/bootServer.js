'use strict';

var Promise = require('bluebird');

module.exports = function () {
	var serverProcess;
	return new Promise(function (resolve) {
		serverProcess = require('child_process').fork(__dirname + '/../../node_modules/Communibase/server.js', {
			env: process.env
		});

		serverProcess.on('message', function (message) {
			if (message === 'online') {
				resolve(serverProcess);
			}
		});
	});
};