A general-purpose Communibase client for node.js projects. It is primarily a Singleton connector doing REST-calls on the Communibase API using a queing system. It returns [A+ promises](https://github.com/promises-aplus/promises-spec) for Communibase responses.

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

The following properties of a communibase connector may be usefull:

```
cbc.serviceUrl // defaults to 'https://api.communibase.nl/0.1/'. May be changed to configure alternative API access
```

API
---

The following methods exists, all returning a [promise](https://github.com/cujojs/when/blob/master/docs/api.md#promise) for a result.

"selectors" may be provided [MongoDb style](http://docs.mongodb.org/manual/reference/method/db.collection.find/#db.collection.find).

"params" is a key value store for e.g. fields, limit, page and/or sort . See [API docs](https://api.communibase.nl/docs/) for more details.

The param ```includeMetadata``` will set a metadata-property on the promise, when available.
```

cbc.getById(objectType, objectId, params) : Promise for Object;

cbc.getByIds(objectType, objectIds, params): Promise for Object[];

cbc.getAll(objectType, params) : Promise for Object[];

cbc.getId(objectType, selector) : Promise for ObjectId[];

cbc.getIds(objectType, selector, params) : Promise for ObjectId[];

cbc.search(objectType, selector, params) : Promise for Object[];

cbc.update(objectType, document) : Promise for Object;

cbc.destroy(objectType, objectId) : Promise for null;

```

Bonus features:

create a readable stream from a File ID:

```

cbc.createReadStream(fileId) : Stream;

```

Work with document history:

```

cbc.getHistory(objectType, objectId) : VersionInformation[];

//Same as above, but with versionId specified...
cbc.getById(objectType, objectId, params, versionId) : Promise for Object;

```