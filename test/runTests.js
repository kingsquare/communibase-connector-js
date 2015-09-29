'use strict';

var setupDatabase = require('./runTests/setupDatabase.js');
var bootServer = require('./runTests/bootServer.js');

//setup proper environment vars and run casper
var dbHost = "localhost";
var dbPort = "27017";

if (process.env.WERCKER_MONGODB_HOST) {
	console.log('Configuring environment vars for Wercker');
	dbHost = process.env.WERCKER_MONGODB_HOST;
	dbPort = process.env.WERCKER_MONGODB_PORT;
}

if (process.env.MONGO_PORT_27017_TCP_ADDR) {
	console.log('Configuring environment vars for linked in mongo-service');
	dbHost = process.env.MONGO_PORT_27017_TCP_ADDR;
	dbPort = process.env.MONGO_PORT_27017_TCP_PORT;
}

// gruntfile / basic variables
process.env.NODE_ENV = 'development';
process.env.PORT = 1025;
process.env.PUBLIC_URL = 'http://localhost:' + process.env.PORT;
process.env.PUBLIC_VERSION = '0.1';
process.env.COMMUNIBASE_API_URL = process.env.PUBLIC_URL + '/' + process.env.PUBLIC_VERSION + '/';

// master db variables
process.env.MASTER_DB_URI = 'mongodb://' + dbHost + ':' + dbPort + '/test_master';
process.env.MASTER_APIKEY = 'master1234567890123456789012345678';
process.env.MASTER_ADMINISTRATION_ID = '525ba35bb32e0e390400000b';

// test db variables
process.env.TEST_ADMINISTRATION_DB_URI = 'mongodb://' + dbHost + ':' + dbPort + '/test_administration';
process.env.COMMUNIBASE_KEY = 'test123456789012345678901234567890';

setupDatabase().then(bootServer).then(function (serverProcess) {
	return require('./runTests/loadFixtures.js')().then(function () {
		return serverProcess;
	});
}).then(function (serverProcess) {
	//var command = "mocha --debug-brk test/tests/";
	var command = "mocha test/tests/";
	var mochaProcess = require('child_process').exec(command, [], { env: process.env });
	mochaProcess.stdout.pipe(process.stdout);
	mochaProcess.stderr.pipe(process.stderr);
	mochaProcess.on('close', function (code) {
		serverProcess.kill();
		process.exit(code);
	});
}, function (err) {
	console.log(err);
	console.log(err.stack);
	process.exit(1);
});