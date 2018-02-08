const moment = require('moment');
const assert = require('assert');
const Promise = require('bluebird');

// Can not perform test, key exists
if (!process.env.SOCKET_SERVICE_URL) {
  console.log('Please set SOCKET_SERVICE_URL environment variable to test cached-behaviour');
} else {
  let ids,
    newHenk;
  const key = process.env.COMMUNIBASE_KEY;
  delete process.env.COMMUNIBASE_KEY;
  let cbc = require('../../lib/index.js').default;
  process.env.COMMUNIBASE_KEY = key;

  describe('Connector', function () {
    this.timeout(10000);
    describe('key handling', () => {
      it('should throw errors when no key is configured', (done) => {
        cbc.getAll('EntityType').then(() => {
          done(new Error('Got response without configured key'));
        }, () => {
          done();
        });
      });

      it('should be able to construct a clone with a different key', (done) => {
        cbc = cbc.clone(process.env.COMMUNIBASE_KEY);
        cbc.enableCache('51909dece4b02025890fc089', process.env.SOCKET_SERVICE_URL);
        cbc.getAll('EntityType').then(() => {
          done();
        }, (err) => {
          done(err);
        });
      });
    });

    describe('promise handling', () => {
      it('should reject the promise with a CommunibaseError when validation fails', (done) => {
        cbc.update('Person', {
          firstName: 'Henk',
          lastName: 'De adressenman',
          registeredDate: new Date(),
          addresses: [{
            street: '', // missing street here!
            streetNumber: '123',
            zipcode: '1234ab',
            city: 'abc-city',
            countryCode: 'NL'
          }]
        }).then(() => { // result
          done(new Error('Should not store invalid document'));
        }, (err) => {
          assert.equal(err instanceof Error, true);
          assert.equal(Object.keys(err.errors).length > 0, true);
          done();
        });
      });
    });

    describe('getAll', () => {
      it('should get all EntityTypes', (done) => {
        cbc.getAll('EntityType').then((entityTypes) => {
          assert.equal(entityTypes && (entityTypes.length > 0), true);
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('getIds', () => {
      it('should get an array of ids', (done) => {
        cbc.getIds('EntityType', { _id: { $exists: true } }).then((entityTypeIds) => {
          ids = entityTypeIds;
          assert.equal(entityTypeIds.length > 0, true);
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('getId', () => {
      it('should get an id', (done) => {
        cbc.getId('EntityType').then((entityTypeId) => {
          assert.equal(entityTypeId.length > 0, true);
          done();
        }, (error) => {
          done(error);
        });
      });

      it('should return undefined when no id is available', (done) => {
        cbc.getId('EntityType', { _id: { $exists: false } }).then((entityTypeId) => {
          assert.equal(entityTypeId, undefined);
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('getById', () => {
      it('should get an object by its id', (done) => {
        cbc.getById('EntityType', ids.pop()).then((entityType) => {
          assert.equal((entityType._id !== undefined), true);
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('getByIds', () => {
      it('should get data by ids', (done) => {
        cbc.getByIds('EntityType', ids).then((entityTypes) => {
          assert.equal(entityTypes.length > 0, true);
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('update', () => {
      it('should not create an invalid document e.g. a person without lastname', (done) => {
        cbc.update('Person', { firstName: 'Henk' }).then(() => {
          done(new Error('Could create an invalid document'));
        }, () => { // error
          done();
        });
      });

      it('should create a valid person', (done) => {
        cbc.update('Person', {
          firstName: 'Henk',
          registeredDate: moment().startOf('day').toDate()
        }).then((result) => {
          assert.equal((result._id === undefined), false);
          newHenk = result;
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('getReadStream', () => {
      it('should produce a readable stream', (done) => {
        let stream = cbc.createReadStream('52498dbaf4277fa813000021'),
          data;
        stream.on('data', (chunk) => {
          data += chunk;
        });
        stream.on('end', () => {
          assert.equal(data.length, 478);
          done();
        });
      });

      it('should produce a stream that throws an error if any', (done) => {
        let stream = cbc.createReadStream('12345'),
          gotError = false;
        stream.on('error', () => { // err?
          gotError = true;
        });
        stream.on('end', () => {
          assert.equal(gotError, true);
          done();
        });
      });
    });

    describe('destroy', () => {
      it('should delete something e.g. a person', (done) => {
        cbc.destroy('Person', newHenk._id).then(() => {
          done();
        }, (error) => {
          done(error);
        });
      });
    });

    describe('queue handling', () => {
      it('should handle/queue a lot of requests properly', (done) => {
        let promise,
          resultPromises = [],
          assertEqual = function (result) {
            assert.equal(result.length, 1);
          };
        for (let i = 0; i < 100; i += 1) {
          promise = cbc.search('EntityType', { _id: ids[0] }).then(assertEqual);
          resultPromises.push(promise);
        }

        Promise.all(resultPromises).then((result) => {
          assert.equal(result.length, 100);
          done();
        });
      });
    });

    describe('metadata handling', () => {
      // @todo fix me for cached connector
      //    it('works', function (done) {
      //      var promise;
      //      promise = cbc.search('EntityType', { _id: { $exists: true }}, {
      //        limit: 1,
      //        includeMetadata: true
      //      });
      //      promise.then(function () {
      //        assert.equal((promise.metadata.total > 1), true);
      //        done();
      //      });
      //    });

      it('does not break on a regular result-object containing a property metadata (e.g. File)', (done) => {
        cbc.getId('File', { metadata: { $exists: true } }).then(fileId => cbc.getById('File', fileId).then((file) => {
          assert.equal((file === undefined), false);
          done();
        }, (err) => {
          done(err);
        }), (err) => {
          done(err);
        });
      });
    });

    describe('aggregation', () => {
      it('works', (done) => {
        cbc.aggregate('Event', [
          { $match: { _id: { $ObjectId: '52f8fb85fae15e6d0806e7c7' } } },
          { $unwind: '$participants' },
          { $group: { _id: '$_id', participantCount: { $sum: 1 } } }
        ]).then((participantCounts) => {
          if (participantCounts && participantCounts.length) {
            assert.equal(participantCounts[0].participantCount > 0, true);
          }
          done();
        }, (err) => {
          done(err);
        });
      });
    });

    describe('getByRef', () => {
      it('works with a correct ref', (done) => {
        cbc.getByRef({
          rootDocumentId: '524aca8947bd91000600000c',
          rootDocumentEntityType: 'Person',
          path: [{
            field: 'addresses',
            objectId: '53440792463cda7161000003'
          }]
        }).then((address) => {
          assert.equal(address.city, 'BEVERWIJK');
          done();
        }, (err) => {
          done(err);
        });
      });

      it('throws an error with an incorrect ref', (done) => {
        cbc.getByRef({
          rootDocumentId: '524aca8947bd91000600000c',
          rootDocumentEntityType: 'Person',
          path: [{
            field: 'addresses',
            objectId: '53440792463cda7161000001'
          }]
        }).then((address) => {
          console.log(address);
          done(new Error('Should not find something'));
        }, (/* err */) => {
          done();
        });
      });
    });
  });
}
