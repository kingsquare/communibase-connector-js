[![Build Status](https://travis-ci.org/kingsquare/communibase-connector-js.png)](https://travis-ci.org/kingsquare/communibase-connector-js)
[![Scrutinizer Quality Score](https://scrutinizer-ci.com/g/kingsquare/communibase-connector-js/badges/quality-score.png?s=94ea144a5b63afdb4ff9b99991f5ca830ba59d37)](https://scrutinizer-ci.com/g/kingsquare/communibase-connector-php/)
[![Latest Stable Version](https://poser.pugx.org/kingsquare/communibase-connector-js/v/stable.png)](https://www.npmjs.org/package/communibase-connector-js)
[![License](https://poser.pugx.org/kingsquare/communibase-connector-js/license.png)](https://www.npmjs.org/package/communibase-connector-js)

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

The ```update```-Promise may be rejected if an entity is not considered valid. The error is in the following format

```
{
	"success": true|false
	"errors": {
		[
			"field": "<string>",
			"message": "<string>"
		], ...
	}
}
```

Bonus features:
--

create a readable stream from a File ID:

```

cbc.createReadStream(fileId) : Stream;

```

Work with document history:

```

cbc.getHistory(entityType, id) : VersionInformation[];

//Same as above, but with versionId specified...
cbc.getById(entityType, id, params, versionId) : Promise for Entity;

```