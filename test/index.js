const fs = require("fs");
const path = require("path");

const setupDatabase = require("./runTests/setupDatabase.js");
const bootServer = require("Communibase/bin/runTests/bootServer");

// setup proper environment vars and run casper
let dbHost = "localhost";
let dbPort = "27017";

if (process.env.WERCKER_MONGODB_HOST) {
  console.log("Configuring environment vars for Wercker");
  dbHost = process.env.WERCKER_MONGODB_HOST;
  dbPort = process.env.WERCKER_MONGODB_PORT;
}

if (process.env.MONGO_PORT_27017_TCP_ADDR) {
  console.log("Configuring environment vars for linked in mongo-service");
  dbHost = process.env.MONGO_PORT_27017_TCP_ADDR;
  dbPort = process.env.MONGO_PORT_27017_TCP_PORT;
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
const winston = require("winston");

winston.level = process.env.NODE_ENV === "development" ? "debug" : "error";

process.env.PORT = 1025;
process.env.PUBLIC_URL = `http://localhost:${process.env.PORT}`;
process.env.PUBLIC_VERSION = "0.1";
process.env.COMMUNIBASE_API_URL = `${process.env.PUBLIC_URL}/${process.env.PUBLIC_VERSION}/`;

// master db variables
process.env.MASTER_DB_URI = `mongodb://${dbHost}:${dbPort}/test_master`;
process.env.MASTER_APIKEY = "master1234567890123456789012345678";
process.env.MASTER_ADMINISTRATION_ID = "525ba35bb32e0e390400000b";

// test db variables
process.env.TEST_ADMINISTRATION_DB_URI = `mongodb://${dbHost}:${dbPort}/test_administration`;
process.env.COMMUNIBASE_KEY = "test123456789012345678901234567890";

process.env.AWS_KEY = "AWS_KEY";
process.env.AWS_SECRET = "AWS_SECRET";
process.env.AWS_S3_EU_WEST_1_KEY = "AWS_S3_EU_WEST_1_KEY";
process.env.AWS_S3_EU_WEST_1_SECRET = "AWS_S3_EU_WEST_1_SECRET";
process.env.AWS_SES_EU_WEST_1_KEY = "AWS_SES_EU_WEST_1_KEY";
process.env.AWS_SES_EU_WEST_1_SECRET = "AWS_SES_EU_WEST_1_SECRET";
process.env.AWS_SES_US_EAST_1_KEY = "AWS_SES_US_EAST_1_KEY";
process.env.AWS_SES_US_EAST_1_SECRET = "AWS_SES_US_EAST_1_SECRET";

setupDatabase()
  .then(bootServer)
  .then(require("./runTests/loadFixtures.js"))
  .then(() => {
    fs.readdirSync(path.join(__dirname, "tests")).forEach((testFile) => {
      require(path.join(__dirname, "tests", testFile));
    });
    run();
  })
  .catch((err) => {
    console.log(err);
    console.log(err.stack);
    process.exit(1);
  });
