[![Build Status](https://travis-ci.org/kingsquare/communibase-connector-js.png)](https://travis-ci.org/kingsquare/communibase-connector-js)

A general-purpose Communibase client for node.js projects. It is primarily a Singleton connector doing REST-calls on the Communibase API using a queuing system. It returns [A+ promises](https://github.com/promises-aplus/promises-spec) for Communibase responses. Behaviour is reflected by a PHP-version that can be found at [Github](https://github.com/kingsquare/communibase-connector-js).

Installation
============

```
npm install --save communibase-connector-js
```

Usage
=====

Make sure environment variable exists with your API-key called COMMUNIBASE_KEY

```
cbc = require('communibase-connector-js');

cbc.search('Person', { firstName: 'henk' }).then(function (henkies) {
	//do something with henkies
});

```

Advanced usage
--------------

When you need to connect using multiple Communibase API Keys for some reason, you need to 'clone' the connector per key.
```
cbc = require('communibase-connector-js').clone(<your api key here>);
```

API
---

The following methods exists, all returning a [promise](https://github.com/cujojs/when/blob/master/docs/api.md#promise) for a result.

"selectors" may be provided [MongoDb style](http://docs.mongodb.org/manual/reference/method/db.collection.find/#db.collection.find).

"params" is a key value store for e.g. fields, limit, page and/or sort . See [API docs](https://api.communibase.nl/docs/) for more details.

The param ```includeMetadata``` will set a metadata-property on the promise, when available.

```

cbc.getById(entityType, id, params): Promise for Entity;

cbc.getByIds(entityType, id[], params): Promise for Entity[];

cbc.getAll(entityType, params): Promise for Entity[];

cbc.getId(entityType, selector): Promise for id[];

cbc.getIds(entityType, selector, params): Promise for id[];

cbc.search(entityType, selector, params): Promise for Entity[];

cbc.update(entityType, document): Promise for Entity;

cbc.destroy(entityType, id): Promise for null;

```

Entity
--
An entity is an plain JavaScript object: a key/value store of data in Communibase.

E.g.

```
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

```
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

```

cbc.createReadStream(fileId) : Stream;

```

Work with document history
--------------------------

```

cbc.getHistory(entityType, id) : VersionInformation[];

//Same as above, but with versionId specified...
cbc.getById(entityType, id, params, versionId) : Promise for Entity;

```

Aggregate document data via Mongodb pipeline. For more information, see
[http://docs.mongodb.org/manual/core/aggregation-pipeline/](http://docs.mongodb.org/manual/core/aggregation-pipeline/)

```

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

```
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

```
cbc.enableCache(communibaseAdministrationId, socketServiceUrl)

```

Contact Kingsquare for these values in your particular scenario and use with caution: BEWARE of excessive memory usage!

