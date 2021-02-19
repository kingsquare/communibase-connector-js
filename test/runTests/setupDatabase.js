const path = require("path");
const Promise = require("bluebird");
const mongodb = require("mongodb");

const { MongoClient } = require("mongodb");
const BSONStream = require("bson-stream");

const { Db, Server } = mongodb;
const url = require("url");
const fs = require("fs");
const winston = require("winston");

function getDropDbPromise(uri) {
  const parsedUrl = url.parse(uri);
  let db = new Db(
    parsedUrl.path.substr(1),
    new Server(parsedUrl.hostname, parsedUrl.port || 27017),
    { safe: false }
  );
  db = Promise.promisifyAll(db);
  return db
    .openAsync()
    .then((_db) => _db.dropDatabase())
    .then(() => {
      db.close();
    });
}

function addSpectialAttributes(entityType) {
  if (entityType.title !== "Person") {
    return entityType;
  }

  entityType.attributes.push({
    title: "sectors",
    isCore: false,
    isRequired: false,
    type: "Array",
    description: "something with sectors",
    items: "string",
    allowableValues: {
      valueType: "List",
      values: ["a", "b", "c", "d", "e"],
    },
  });

  return entityType;
}

function importBsonEntityTypes(bsonFileLocation, dbUri) {
  return new Promise((resolve, reject) => {
    const bson = new BSONStream();
    fs.createReadStream(bsonFileLocation).pipe(bson);
    const toBeSavedEntityTypes = [];

    bson.on("data", (entityType) =>
      toBeSavedEntityTypes.push(addSpectialAttributes(entityType))
    );

    bson.on("end", () => {
      const client = new MongoClient(dbUri);
      MongoClient.connect(dbUri)
        .then((administrationConnection) =>
          Promise.promisifyAll(
            administrationConnection.collection("EntityType")
          )
            .insertAsync(toBeSavedEntityTypes)
            .then(() => {
              administrationConnection.close();
            })
        )
        .then(resolve, reject);
    });
  });
}

module.exports = function () {
  const adminMongooseConnection = require(`${__dirname}/../../node_modules/Communibase/inc/mongeese/createAdminMongoose.js`)(
    process.env.MASTER_DB_URI
  );

  const adminMongooseConnectionReadyDeferred = new Promise((resolve) => {
    adminMongooseConnection.once("open", resolve);
  });

  return Promise.all([
    adminMongooseConnectionReadyDeferred,
    getDropDbPromise(process.env.MASTER_DB_URI),
    getDropDbPromise(process.env.TEST_ADMINISTRATION_DB_URI),
  ])
    .then(() => {
      winston.debug("Saving new master key");

      return Promise.promisifyAll(
        adminMongooseConnection.models.ApiKey.collection
      ).insertAsync({
        administrationId: process.env.MASTER_ADMINISTRATION_ID,
        key: process.env.MASTER_APIKEY,
        description: "The API unittest master test key",
        email: "unittest@kingsquare.nl",
        apiEndpoints: [],
        propertyAccessDescriptions: [],
      });
    })
    .then(() => {
      winston.debug("Saving new adminisitration");

      return adminMongooseConnection.models.Administration.create({
        title: "Unittest administration",
        dbUri: process.env.TEST_ADMINISTRATION_DB_URI,
        type: "Kingsquare",
      }).then((administration) => {
        process.env.TEST_ADMINISTRATION_ID = administration._id;
        return Promise.resolve(administration._id);
      });
    })
    .then((administrationId) => {
      winston.debug("Saving new administration key!");
      return adminMongooseConnection.models.ApiKey.create({
        administrationId,
        key: process.env.COMMUNIBASE_KEY,
        description: "The API unittest administration test key",
        email: "unittest@kingsquare.nl",
        apiEndpoints: [],
        propertyAccessDescriptions: [],
      });
    })
    .then(() => adminMongooseConnection.close())
    .then(() => {
      winston.debug("Inserting administration entitytypes...");
      return importBsonEntityTypes(
        path.resolve(
          __dirname,
          "../../node_modules/Communibase/test/resources/dump/blueprint/EntityType.bson"
        ),
        process.env.TEST_ADMINISTRATION_DB_URI
      );
    });
};
