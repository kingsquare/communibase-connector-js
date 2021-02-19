const fs = require("fs");
const Promise = require("bluebird");

describe("Async connectors", function (done) {
  this.timeout(10000);

  try {
    privateApiKeysWithGroupIds = JSON.parse(
      fs.readFileSync("./privateApiKeysWithGroupIds.json")
    );
  } catch (e) {
    console.log(
      "** privateApiKeysWithGroupIds.json not found, skipping test **"
    );
    return;
  }

  it("should work with multiple connectors in multiple administratations", (done) => {
    const cbc = require("../../lib/index.js").default;
    const promises = [],
      cbcs = {};

    Object.keys(privateApiKeysWithGroupIds).forEach((apiKey) => {
      cbcs[apiKey] = cbc.clone(apiKey);
      promises.push(
        cbcs[apiKey].getById("Group", privateApiKeysWithGroupIds[groupId])
      );
    });
    Object.keys(privateApiKeysWithGroupIds).forEach((apiKey) => {
      promises.push(
        cbcs[apiKey].getById("Group", privateApiKeysWithGroupIds[groupId])
      );
    });

    Promise.all(promises).then(() => {
      done();
    }, done);
  });
});
