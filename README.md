[![Known Vulnerabilities](https://snyk.io/test/github/kingsquare/communibase-connector-js/badge.svg)](https://snyk.io/test/github/kingsquare/communibase-connector-js)

A general-purpose Communibase client for node.js projects. It is primarily a Singleton connector doing REST-calls on the Communibase API using a queuing system. It returns [A+ promises](https://github.com/promises-aplus/promises-spec) for Communibase responses. Behaviour is reflected by a PHP-version that can be found at [Github](https://github.com/kingsquare/communibase-connector-js).

Installation
============

```
npm install --save communibase-connector-js
```

Usage
=====

Make sure environment variable exists with your API-key called COMMUNIBASE_KEY

```js
cbc = require('communibase-connector-js');

cbc.search('Person', { firstName: 'Tim' }).then(function (peopleCalledTim) {
	//do something with peopleCalledTim
});
```

Advanced usage
--------------

When you need to connect using multiple Communibase API Keys for some reason, you need to 'clone' the connector per key.

```js
cbc = require('communibase-connector-js').clone(<your api key here>);
```

If you need to connect to a specific version of the endpoint, you may want to set a environment variable ```COMMUNIBASE_API_URL``` e.g.

```js
COMMUNIBASE_API_URL=https://api.communibase.nl/0.1/
```

### Use via a tunnel requires also adding an extra Host header

```bash
COMMUNIBASE_API_URL=https://17.42.0.1:8888/0.1/ COMMUNIBASE_API_HOST=api.communibase.nl node script.js
```

API
---

The following methods exists, all returning a [promise](https://github.com/petkaantonov/bluebird/blob/master/API.md#new-promisefunctionfunction-resolve-function-reject-resolver---promise) for a result.

"selectors" may be provided [MongoDb style](http://docs.mongodb.org/manual/reference/method/db.collection.find/#db.collection.find).

"params" is a key value store for e.g. fields, limit, page and/or sort . See [API docs](https://api.communibase.nl/docs/) for more details.

The param ```includeMetadata``` will set a metadata-property on the promise, when available.

```js
cbc.getById(entityType, id, params): Promise for Entity;

cbc.getByIds(entityType, id[], params): Promise for Entity[];

cbc.getAll(entityType, params): Promise for Entity[];

cbc.getId(entityType, selector): Promise for id[];

cbc.getIds(entityType, selector, params): Promise for id[];

cbc.search(entityType, selector, params): Promise for Entity[];

cbc.update(entityType, document): Promise for Entity;

cbc.destroy(entityType, id): Promise for null;

cbc.undelete(entityType, id): Promise for null;
```

Entity
--
An entity is an plain JavaScript object: a key/value store of data in Communibase, also called "document".

E.g.

```js
{
	"firstName": "Tim",
	"addresses": [
		{
			"street": "Breestraat"
		}
	]
}

```

Error handling
--

The ```update```-Promise may be rejected if an entity is not considered valid. The Error has one or more of the following properties:

```js
{
	"message": <a simplified error-string>
	"code": <http response code of API>
	"errors": {
		[
			"field": "<string>",
			"message": "<string>"
		], ...
	}
}
```

Bonus features
==============
--

create a readable stream
------------------------

```js
cbc.createReadStream(fileId) : Stream;
```

Work with document history
--------------------------

First, find the _id of both the document and the version you are looking for. To find all available versions of a specific document, use

```js
cbc.getHistory(entityType, id) : Promise for  VersionInformation[];
```

Alternatively, you can search the entire history of documents to look for specific properties. e.g.

```js
//Lookup all versions of any person (even deleted documents) ever with first name Tim.

cbc.historySearch('Person', { firstName: 'Tim' }): Promise for VersionInformation[]
```

VersionInformation has the following structure
* _id - The _id of the version.
* refId - The _id of the original document. You can use this at the regular CRUD endpoint
* updatedAt - The date this version was created
* updatedBy - A human readable description describing who created it

With an _id and a refId, we can lookup that specific version via the API

```js
cbc.getById(entityType, id, params, versionId) : Promise for version of document;
```

Aggregate document data via Mongodb pipeline. For more information, see
[http://docs.mongodb.org/manual/core/aggregation-pipeline/](http://docs.mongodb.org/manual/core/aggregation-pipeline/)

```js
cbc.aggregate(entityType, aggregationPipeline);

//Example:
var participantCounters = cbc.aggregate('Event', [
	{ "$match": { "_id": {"$ObjectId": "52f8fb85fae15e6d0806e7c7"} } },
	{ "$unwind": "$participants" },
	{ "$group": { "_id": "$_id", "participantCount": { "$sum": 1 } } }
]);
```

Work with "DocumentReferences"
------------------------------

A DocumentReference is a unified specification to point to some other (sub-)doucment
within the administration. A DocumentReference looks like:

```js
{
	rootDocumentId: '524aca8947bd91000600000c',
	rootDocumentEntityType: 'Person',
	path: [
		{
			field: 'addresses',
			objectId: '53440792463cda7161000003'
		}, ...
	]
}
```

The contents will be parsed and the requested data will be retrieved.

EXPERIMENTAL - Work with local in-memory cache for query results
----------------------------------------------------------------

The connector may cache documents locally. To enable in-memory cache for a certain instance of the connector:

```js
cbc.enableCache(communibaseAdministrationId, socketServiceUrl)
```

Contact Kingsquare for these values in your particular scenario and use with caution: BEWARE of excessive memory usage!
