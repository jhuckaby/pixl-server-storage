# Overview

This module is a component for use in [pixl-server](https://www.npmjs.com/package/pixl-server).  It implements a simple key/value storage system that can use multiple back-ends, such as [Amazon S3](https://aws.amazon.com/s3/), [Couchbase](http://www.couchbase.com/nosql-databases/couchbase-server), [Redis](https://redis.io/), or a local filesystem.  It introduces the concept of a "chunked linked list", which supports extremely fast push, pop, shift, unshift, and random reads/writes.  Also provided is a fast hash table implementation with key iteration, a transaction system, and an indexing and search system.

## Features at a Glance

* Uses very little memory in most cases.
* Store JSON or binary (raw) data records.
* Supports multiple back-ends including Amazon S3, Couchbase, Redis, and local filesystem.
* Linked lists with very fast push, pop, shift, unshift, and random reads/writes.
* Hash tables with key iterators, and very fast reads / writes.
* Advisory locking system with shared and exclusive locks.
* Variable expiration dates per key and automatic deletion.
* Transaction system for isolated compound operations and atomic commits, rollbacks.
* Indexing system for searches across collections of JSON records.
* Supports Google-style full-text search queries.

## Table of Contents

The documentation is split up across six files:

- &rarr; **[Main Docs](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)** *(You are here)*
- &rarr; **[Lists](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Lists.md)**
- &rarr; **[Hashes](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Hashes.md)**
- &rarr; **[Transactions](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Transactions.md)**
- &rarr; **[Indexer](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md)**
- &rarr; **[API Reference](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/API.md)**

Here is the table of contents for this current document:

<!-- toc -->
- [Usage](#usage)
	* [Standalone Mode](#standalone-mode)
- [Configuration](#configuration)
	* [engine](#engine)
	* [engine_path](#engine_path)
	* [list_page_size](#list_page_size)
	* [hash_page_size](#hash_page_size)
	* [concurrency](#concurrency)
	* [maintenance](#maintenance)
	* [log_event_types](#log_event_types)
	* [max_recent_events](#max_recent_events)
	* [expiration_updates](#expiration_updates)
	* [lower_case_keys](#lower_case_keys)
	* [debug (standalone)](#debug-standalone)
- [Engines](#engines)
	* [Local Filesystem](#local-filesystem)
		+ [Key Namespaces](#key-namespaces)
		+ [Raw File Paths](#raw-file-paths)
		+ [Key Template](#key-template)
		+ [Filesystem Cache](#filesystem-cache)
	* [Amazon S3](#amazon-s3)
		+ [S3 File Extensions](#s3-file-extensions)
		+ [S3 Key Prefix](#s3-key-prefix)
		+ [S3 Key Template](#s3-key-template)
		+ [S3 Cache](#s3-cache)
	* [Couchbase](#couchbase)
	* [Redis](#redis)
		+ [RedisCluster](#rediscluster)
	* [SQLite](#sqlite)
	* [Hybrid](#hybrid)
- [Key Normalization](#key-normalization)
- [Basic Functions](#basic-functions)
	* [Storing Records](#storing-records)
	* [Fetching Records](#fetching-records)
	* [Copying Records](#copying-records)
	* [Renaming Records](#renaming-records)
	* [Deleting Records](#deleting-records)
- [Storing Binary Blobs](#storing-binary-blobs)
- [Using Streams](#using-streams)
- [Expiring Data](#expiring-data)
	* [Custom Record Types](#custom-record-types)
- [Advisory Locking](#advisory-locking)
- [Logging](#logging)
	* [Debug Logging](#debug-logging)
	* [Error Logging](#error-logging)
	* [Transaction Logging](#transaction-logging)
	* [Performance Logs](#performance-logs)
- [Performance Metrics](#performance-metrics)
- [Daily Maintenance](#daily-maintenance)
- [Plugin Development](#plugin-development)
- [Unit Tests](#unit-tests)
- [License](#license)

# Usage

Use [npm](https://www.npmjs.com/) to install the module:

```
npm install pixl-server pixl-server-storage
```

Here is a simple usage example.  Note that the component's official name is `Storage`, so that is what you should use for the configuration key, and for gaining access to the component via your server object.

```javascript
var PixlServer = require('pixl-server');
var server = new PixlServer({
	
	__name: 'MyServer',
	__version: "1.0",
	
	config: {
		"log_dir": "/var/log",
		"debug_level": 9,
		
		"Storage": {
			"engine": "Filesystem",
			"Filesystem": {
				"base_dir": "/var/data/myserver",
			}
		}
	},
	
	components: [
		require('pixl-server-storage')
	]
	
});

server.startup( function() {
	// server startup complete
	var storage = server.Storage;
	
	// store key
	storage.put( 'test-key', { foo:"hello", bar:42 }, function(err) {
		if (err) throw err;
		
		// fetch key
		storage.get( 'test-key', function(err, data) {
			if (err) throw err;
			console.log(data);
		} );
	} );
} );
```

Notice how we are loading the [pixl-server](https://www.npmjs.com/package/pixl-server) parent module, and then specifying [pixl-server-storage](https://www.npmjs.com/package/pixl-server-storage) as a component:

```javascript
components: [
	require('pixl-server-storage')
]
```

This example is a very simple server configuration, which will start a local filesystem storage instance pointed at `/var/data/myserver` as a base directory.  It then simply stores a test key, then fetches it back.

## Standalone Mode

If you want to access the storage component as a standalone class (i.e. not part of a [pixl-server](https://www.npmjs.com/package/pixl-server) server daemon), you can require the `pixl-server-storage/standalone` path and invoke it directly.  This can be useful for things like simple CLI scripts.  Example usage:

```javascript
var StandaloneStorage = require('pixl-server-storage/standalone');

var config = {
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver"
	}
};

var storage = new StandaloneStorage(config, function(err) {
	if (err) throw err;
	// storage system has started up and is ready to go
	
	storage.put( 'test-key', { foo:"hello", bar:42 }, function(err) {
		if (err) throw err;
		
		// fetch key
		storage.get( 'test-key', function(err, data) {
			if (err) throw err;
			console.log(data);
			
			// we have to shutdown manually
			storage.shutdown( function() { 
				process.exit(0); 
			} );
		} );
	} );
});
```

Please note that standalone mode does not perform standard [pixl-server](https://www.npmjs.com/package/pixl-server) timer operations like emit `tick` and `minute` events, so things like performance metrics collection and [Daily Maintenance](#daily-maintenance) do not run.  It also doesn't register standard [SIGINT / SIGTERM](https://nodejs.org/api/process.html#process_signal_events) signal listeners for handing shutdown, so these must be handled by your code.

# Configuration

The configuration for this component is set by passing in a `Storage` key in the `config` element when constructing the `PixlServer` object, or, if a JSON configuration file is used, a `Storage` object at the outermost level of the file structure.  It can contain the following keys:

## engine

The `engine` property is used to declare the name of the back-end storage engine to use.  Specifically, this is for using one of the built-in engine modules located in the `pixl-server-storage/engines/` directory.  See [Engines](#engines) below for details.  Example:

```javascript
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver"
	}
}
```

Note that the engine's own configuration should always go into a property named the same as the engine itself, in this case `Filesystem`.

## engine_path

The `engine_path` property can be used to load your own custom engine in any location.  The path should be either absolute, or relative to the location of the `pixl-server-storage/` directory.  Example:

```javascript
{
	"engine": "MyCustomEngine",
	"engine_path": "../../my_custom_storage_engine.js",
	"MyCustomEngine": {
		"something": "foo"
	}
}
```

All engines must have a name, so you always need to declare a `engine` property with a string, and that should always match a property containing engine-specific configuration directives.  See [Plugin Development](#plugin-development) for more details.

## list_page_size

The `list_page_size` property specifies the default page size (number of items per page) for new lists.  However, you can override this per each list when creating them.  See [Lists](docs/Lists.md) for details.

## hash_page_size

The `hash_page_size` property specifies the default page size (number of items per page) for new hashes.  However, you can override this per each hash when creating them.  See [Hashes](docs/Hashes.md) for details.

## concurrency

The `concurrency` property allows some operations to be parallelized in the storage engine.  This is mainly used for list and maintenance operations, which may involve loading and saving multiple records.  The default value is `1`.  Increase this number for potentially faster operations in some cases.

## maintenance

The `maintenance` property allows the storage system to run routine maintenance, and is highly recommended for daemons that run 24x7.  This is typically enabled to run nightly, and performs tasks such as deleting expired records.  To enable it, set this to any `HH:MM` string where `HH` is the hour in 24-hour time and `MM` is the minute.  Pad with a zero if either value is under 10.  Example:

```javascript
{
	"maintenance": "04:30" // run daily at 4:30 AM
}
```

Make sure your server's clock and timezone are correct.  The values are always assumed to be in the current timezone.

## log_event_types

The `log_event_types` property allows you to configure exactly which transaction event types are logged.  By default, none of them are. For details, see the [Transaction Logging](#transaction-logging) section below.

## max_recent_events

The `max_recent_events` property allows the storage system to track the latest N events in memory, which are then provided in the call to [getStats()](docs/API.md#getstats).  For details, see the [Performance Metrics](#performance-metrics) section below.

## expiration_updates

The `expiration_updates` property activates additional features in the [expiration system](#expiring-data).  Namely, setting this property to `true` allows you to update expiration dates of existing records.  Otherwise only a single expiration date may be set once per each record.

Note that this feature incurs additional overhead, because the expiration date of every record needs to be stored in a global [Hash](docs/Hashes.md).  This slows down both the expiration set operation, and the nightly maintenance sweep to delete expired records.  For this reason, the `expiration_dates` property defaults to `false` (disabled).

## lower_case_keys

The `lower_case_keys` property causes all storage keys to be internally lower-cased, effectively making all storage paths case-insensitive.  This is the default (`true`).  If you set this property to `false`, then all storage keys retain their natural casing, effectively making them case-sensitive.

Please note that if you use the [Local Filesystem](#local-filesystem) engine, then the filesystem itself may be case-insensitive (e.g. legacy macOS HFS).

## debug (standalone)

The `debug` property is only used when using [Standalone Mode](#standalone-mode).  Setting this to `true` will cause the engine to emit debugging messages to the console.

# Engines

The storage system can be backed by a number of different "engines", which actually perform the reads and writes.  A simple local filesystem implementation is included, as well as modules for Amazon S3, Couchbase and Redis.  Each one requires a bit of extra configuration.

## Local Filesystem

The local filesystem engine is called `Filesystem`, and reads/writes files to local disk.  It distributes files by hashing their keys using [MD5](https://en.wikipedia.org/wiki/MD5), and splitting up the path into several subdirectories.  So even with tens of millions of records, no one single directory will ever have more than 256 files.  For example:

```
Plain Key:
test1

MD5 Hash:
5a105e8b9d40e1329780d62ea2265d8a

Partial Filesystem Path:
/5a/10/5e/5a105e8b9d40e1329780d62ea2265d8a.json
```

The partial path is then combined with a base directory, which is configurable.  Here is an example configuration:

```javascript
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver"
	}
}
```

So, putting all this together, the `test1` key would be stored on disk at this location:

```
/var/data/myserver/5a/10/5e/5a105e8b9d40e1329780d62ea2265d8a.json
```

For binary records, the file extension will match whatever was in the key.

### Key Namespaces

To help segment your application data into categories on the filesystem, an optional `key_namespaces` configuration parameter can be specified, and set to a true value.  This will modify the key hashing algorithm to include a "prefix" directory, extracted from the plain key itself.  Example configuration:

```javascript
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver",
		"key_namespaces": true
	}
}
```

Here is an example storage key and how to gets translated to the a filesystem path:

```
Plain Key:
users/jhuckaby

MD5 Hash:
019aaa6887e5ce3533dcc691b05e69e4

Partial Filesystem Path:
/users/01/9a/aa/019aaa6887e5ce3533dcc691b05e69e4.json
```

So in this case the `users` prefix is extracted from the plain key, and then inserted at the beginning of the hash directories.  Here is the full filesystem path, assuming a base directory of `/var/data/myserver`:

```
/var/data/myserver/users/01/9a/aa/019aaa6887e5ce3533dcc691b05e69e4.json
```

In order to use key namespaces effectively, you need to make sure that *all* your plain keys contain some kind of namespace prefix, followed by a slash.  The idea is, you can then store your app's data in different physical locations using symlinks.  You can also determine how much disk space is taken up by each of your app's data categories, without having to walk all the hash directories.

### Raw File Paths

For testing purposes, or for small datasets, you can optionally set the `raw_file_paths` Filesystem configuration parameter to any true value.  This will skip the MD5 hashing of all filesystem paths, and literally write them to the filesystem verbatim, as they come in (well, after [Key Normalization](#key-normalization) of course).  Example configuration:

```javascript
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver",
		"raw_file_paths": true
	}
}
```

So with raw file paths enabled our example key (`users/jhuckaby`) would literally end up on the filesystem right here:

```
/var/data/myserver/users/jhuckaby.json
```

Using this mode you can easily overwhelm a filesystem with too many files in a single directory, depending on how you format your keys.  It is really only meant for testing purposes.

Note that if `raw_file_paths` is enabled, `key_namespaces` has no effect.

### Key Template

For complete, low-level control over the key hashing and directory layout, you can specify a key "template" via the `key_template` configuration property.  This allows you to specify exactly how the directories are laid out, and whether the full plain key is part of the directory path, or just the MD5 hash.  For example, consider this configuration:

```javascript
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver",
		"key_template": "##/##/##/[md5]"
	}
}
```

If your `key_template` property contains any hash marks (`#`), they will be dynamically replaced with characters from an [MD5 hash](https://en.wikipedia.org/wiki/MD5) of the key.  Also, `[md5]` will be substituted for the full MD5 hash, and `[key]` will be substituted with the full key itself.  So for another example:

```js
"key_template": "##/##/[key]"
```

This would replace the 4 hash marks with the first 4 characters from the key's MD5, followed by the full key itself e.g. `a5/47/users/jhuckaby`.  Note that this all happens behind the scenes and transparently, so you never have to specify the prefix or hash characters when fetching keys.

### Filesystem Cache

You can optionally enable caching for the filesystem, which keeps a copy of the most recently used JSON records in RAM.  This can increase performance if you have a small set of popular keys that are frequently accessed.  Note that the cache does *not* defer writes -- it only passively holds copies in memory, to intercept and accelerate repeat reads.

To enable the filesystem cache, include a `cache` object in your `Filesystem` configuration with the following properties:

```js
{
	"engine": "Filesystem",
	"Filesystem": {
		"base_dir": "/var/data/myserver",
		"cache": {
			"enabled": true,
			"maxItems": 1000,
			"maxBytes": 10485760
		}
	}
}
```

The properties are as follows:

| Property Name | Type | Description |
|---------------|------|-------------|
| `enabled` | Boolean | Set this to `true` to enable the filesystem caching system. |
| `maxItems` | Integer | This is the maximum number of objects to allow in the cache. |
| `maxBytes` | Integer | This is the maximum number of bytes to allow in the cache. |

The cache will automatically expire objects in LRU fashion when either of the limits are exceeded (whichever is hit first).  Set the properties to `0` for no limit.

Note that binary records are **not** cached.  This system is for JSON records only.

## Amazon S3

If you want to use [Amazon S3](http://aws.amazon.com/s3/) as a backing store, configure your storage thusly:

```javascript
{
	"engine": "S3",
	"AWS": {
		"region": "us-west-1",
		"credentials": {
			"accessKeyId": "YOUR_AMAZON_ACCESS_KEY", 
			"secretAccessKey": "YOUR_AMAZON_SECRET_KEY"
		}
	},
	"S3": {
		"connectTimeout": 5000,
		"socketTimeout": 5000,
		"maxAttempts": 50,
		"keyPrefix": "",
		"fileExtensions": true,
		"params": {
			"Bucket": "MY_S3_BUCKET_ID"
		},
		"cache": {
			"enabled": true,
			"maxItems": 1000,
			"maxBytes": 10485760
		}
	}
}
```

Replace `YOUR_AMAZON_ACCESS_KEY` and `YOUR_AMAZON_SECRET_KEY` with your Amazon Access Key and Secret Key, respectively.  These can be generated on the Security Credentials page.  Replace `MY_S3_BUCKET_ID` with the ID if your own S3 bucket.  Make sure you match up the region too.

If you plan on using Amazon AWS in other parts of your application, you can actually move the `AWS` config object into your outer server configuration.  The storage module will look for it there.

### S3 File Extensions

It is highly recommended that you set the S3 `fileExtensions` property to `true`, as shown in the example above.  This causes pixl-server-storage to append a file extension to all JSON S3 records when storing them.  For example, a key like `users/jhuckaby` would be stored in S3 as `users/jhuckaby.json`.  The benefit of this is that it plays nice with tools that copy or sync S3 data, including the popular [Rclone](https://rclone.org/) application.

This all happens behind the scenes, and is invisible to the pixl-server-storage APIs.  So you do not have to add any JSON record file extensions yourself, when storing, fetching or deleting your records.

Note that [binary keys](#storing-binary-blobs) already have file extensions, so they are excluded from this feature.  This only affects JSON records.

### S3 Key Prefix

The S3 engine supports an optional key prefix, in case you are sharing a bucket with other applications, and want to keep all your app related records separate.  To specify this, include a `keyPrefix` property in your `S3` object (this goes alongside the `params`, but not inside of it).  Example:

```js
{
	"S3": {
		"keyPrefix": "myapp",
		"params": {
			"Bucket": "MY_S3_BUCKET_ID"
		}
	}
}
```

This would prefix the string `myapp` before all your application keys (a trailing slash will be added after the prefix if needed).  For example, if your app tried to write a record with key `users/jhuckaby`, the actual S3 key would end up as `myapp/users/jhuckaby`.

### S3 Key Template

Note that Amazon [recommends adding a hash prefix](https://docs.aws.amazon.com/AmazonS3/latest/dev/request-rate-perf-considerations.html) to all your S3 keys, for performance reasons.  To that end, if you specify a `keyTemplate` property, and it contains any hash marks (`#`), they will be dynamically replaced with characters from an [MD5 hash](https://en.wikipedia.org/wiki/MD5) of the key.  So for example:

```js
"keyTemplate": "##/##/[key]"
```

This would replace the 4 hash marks with the first 4 characters from the key's MD5 digest, followed by the full key itself, e.g. `a5/47/users/jhuckaby`.  Note that this all happens behind the scenes and transparently, so you never have to specify the prefix or hash characters when fetching keys.

Besides hash marks, the special macro `[key]` will be substituted with the full key, and `[md5]` will be substituted with a full MD5 hash of the key.  These can be used anywhere in the template string.

### S3 Cache

It is *highly* recommended that you enable caching for S3, which keeps a copy of the most recently used JSON records in RAM.  Not only will this increase overall performance, but it is especially important if you use any of the advanced storage features like [Lists](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Lists.md), [Hashes](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Hashes.md), [Transactions](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Transactions.md) or the [Indexer](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md).

To enable the S3 cache, include a `cache` object in your `S3` configuration with the following properties:

```js
"cache": {
	"enabled": true,
	"maxItems": 1000,
	"maxBytes": 10485760
}
```

The properties are as follows:

| Property Name | Type | Description |
|---------------|------|-------------|
| `enabled` | Boolean | Set this to `true` to enable the S3 caching system. |
| `maxItems` | Integer | This is the maximum number of objects to allow in the cache. |
| `maxBytes` | Integer | This is the maximum number of bytes to allow in the cache. |

The cache will automatically expire objects in LRU fashion when either of the limits are met (whichever is reached first).  Set the properties to `0` for no limit.

It is recommended that you set the `maxItems` and `maxBytes` high enough to allow new data written to live for *at least* several seconds before getting expired out of the cache.  This depends on the overall storage throughput of your application, but 1,000 max items and 10 MB max bytes is probably fine for most use cases.

Note that binary records are **not** cached, as they are generally large.  Only JSON records are cached, as they are usually much smaller and used in [Lists](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Lists.md), [Hashes](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Hashes.md), [Transactions](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Transactions.md) and the [Indexer](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md).

## Couchbase

Please note that as of this writing (April 2022), pixl-server-storage only supports Couchbase Client v2, so you need to force install version `2.6.12` (see instructions below).  Work is underway to support the v3 API, which has many breaking changes.

If you want to use [Couchbase](http://www.couchbase.com/nosql-databases/couchbase-server) as a backing store, here is how to do so.  First, you need to manually install the [couchbase](https://www.npmjs.com/package/couchbase) module into your app, and it **must be v2**:

```
npm install --save couchbase@2.6.12
```

Then configure your storage thusly:

```javascript
{
	"engine": "Couchbase",
	"Couchbase": {
		"connectString": "couchbase://127.0.0.1",
		"bucket": "default",
		"username": "",
		"password": "",
		"serialize": false,
		"keyPrefix": ""
	}
}
```

Set the `connectString` for your own Couchbase server setup.  You can embed a username and password into the string if they are required to connect (this is different from the bucket password), and use `couchbases://` for SSL, if desired.

The `bucket` property should be set to the bucket name.  If you don't know this then `default` is probably correct.  The `password` property is the bucket password, and may or may not be required, depending on your Couchbase server setup.

The `serialize` property, when set to `true`, will cause all object values to be serialized to JSON before storing, and they will also be parsed from JSON when fetching.  When set to `false` (the default), this is left up to Couchbase to handle.

The optional `keyPrefix` property works similarly to the [S3 Key Prefix](#s3-key-prefix) feature.  It allows you to prefix all the Couchbase keys with a common string, to separate your application's data in a shared bucket situation.

The optional `keyTemplate` property works similarly to the [S3 Key Template](#s3-key-template) feature.  It allows you to specify an exact layout of MD5 hash characters, which can be prefixed, mixed in with or postfixed after the key.

Note that for Couchbase Server v5.0+ (Couchbase Node SDK 2.5+), you will have to supply both a `username` and `password` for a valid user created in the Couchbase UI.  Prior to v5+ you could omit the `username` and only specify a `password`, or no password at all if your bucket has no authentication.

## Redis

If you want to use [Redis](https://redis.io/) as a backing store, here is how to do so.  First, you need to manually install the [redis](https://www.npmjs.com/package/redis) module into your app:

```
npm install --save redis
```

Then configure your storage thusly:

```javascript
{
	"engine": "Redis",
	"Redis": {
		"host": "127.0.0.1",
		"port": 6379,
		"keyPrefix": ""
	}
}
```

Set the `host` and `port` for your own Redis server setup.  Please see [Redis Options Properties](https://github.com/NodeRedis/node_redis#options-object-properties) for other things you can include here, such as authentication and database selection.

The optional `keyPrefix` property works similarly to the [S3 Key Prefix](#s3-key-prefix) feature.  It allows you to prefix all the Redis keys with a common string, to separate your application's data in a shared database situation.

The optional `keyTemplate` property works similarly to the [S3 Key Template](#s3-key-template) feature.  It allows you to specify an exact layout of MD5 hash characters, which can be prefixed, mixed in with or postfixed after the key.

### RedisCluster

If you want to use a Redis cluster (e.g. [AWS ElastiCache](https://aws.amazon.com/elasticache/)), then here is how to do that.  First, you will need to manually install the following two modules into your app:

```
npm install --save ioredis ioredis-timeout
```

Then configure your storage thusly:

```javascript
{
	"engine": "RedisCluster",
	"RedisCluster": {
		"host": "127.0.0.1",
		"port": 6379,
		"timeout": 1000,
		"connectRetries": 5,
		"clusterOpts": {
			"scaleReads": "master"
		},
		"keyPrefix": ""
	}
}
```

Set the `host` and `port` for your own Redis cluster setup.  The `host` should point to the cluster endpoint, **not** an individual Redis server.  Set the `timeout` to the desired operation timeout in milliseconds (it defaults to `1000`).  The `connectRetries` sets the number of retries on the initial socket connect operation (it defaults to `5`).

The `clusterOpts` property can hold several different cluster configuration options.  Please see the [ioredis API docs](https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options) for other things you can include here, such as authentication and database selection.  It is **highly recommended** that you keep the `scaleReads` property set to `"master"`, for immediate consistency (required for [Lists](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Lists.md), [Hashes](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Hashes.md), [Transactions](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Transactions.md) and the [Indexer](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md)).

The optional `keyPrefix` property works similarly to the [S3 Key Prefix](#s3-key-prefix) feature.  It allows you to prefix all the Redis keys with a common string, to separate your application's data in a shared database situation.

The optional `keyTemplate` property works similarly to the [S3 Key Template](#s3-key-template) feature.  It allows you to specify an exact layout of MD5 hash characters, which can be prefixed, mixed in with or postfixed after the key.

## SQLite

If you want to use [SQLite](https://sqlite.com/) as a backing store, here is how to do so.  First, you need to manually install the [sqlite3](https://www.npmjs.com/package/sqlite3) module into your app:

```
npm install --save sqlite3
```

Then configure your storage thusly:

```javascript
{
	"engine": "SQLite",
	"SQLite": {
		"base_dir": "data",
		"filename": "sqlite.db",
		"pragmas": {
			"auto_vacuum": 0,
			"cache_size": -100000
		}
	}
}
```

The `base_dir` defaults to the current working directory, and will be created on startup if necessary.  The `filename` is the name of the SQLite DB file on disk (also created if necessary).

The optional `pragmas` object allows you set one or more [SQLite Pragmas](https://www.sqlite.org/pragma.html#toc) (configuration settings) on the database at startup.  Here you can specify things such as [auto_vacuum](https://www.sqlite.org/pragma.html#pragma_auto_vacuum) and [cache_size](https://www.sqlite.org/pragma.html#pragma_cache_size), among many others.

## Hybrid

Your application may need the features of multiple engines.  Specifically, you may want JSON (document) records to use one engine, and binary records to use another.  Binary records are specified with keys that end in a file extension, e.g. `.jpg`.  To facilitate this, there is a `Hybrid` engine available, which can load multiple sub-engines, one for JSON keys and one for binary keys.  Example use:

```json
{
	"engine": "Hybrid",
	"Hybrid": {
		"docEngine": "Filesystem",
		"binaryEngine": "S3"
	}
}
```

The `Hybrid` engine only has two properties, `docEngine` and `binaryEngine`.  These should be set to the names of sub-engines to load and use for JSON (document) records and binary records respectively.  In this example we're using the `Filesystem` engine for JSON (document) records, and the `S3` engine for binary records.  The idea is that you also include configuration objects for each of the sub-engines:

```json
{
	"engine": "Hybrid",
	"Hybrid": {
		"docEngine": "Filesystem",
		"binaryEngine": "S3"
	},
	"Filesystem": {
		"base_dir": "/var/data/myserver"
	},
	"AWS": {
		"accessKeyId": "YOUR_AMAZON_ACCESS_KEY", 
		"secretAccessKey": "YOUR_AMAZON_SECRET_KEY", 
		"region": "us-west-1"
	},
	"S3": {
		"fileExtensions": true,
		"params": {
			"Bucket": "MY_S3_BUCKET_ID"
		}
	}
}
```

Note that all of the engine configuration objects are on the same level as the `Hybrid` object.

# Key Normalization

In order to maintain compatibility with all the various engines, keys are "normalized" on all entry points.  Specifically, they undergo the following transformations before being passed along to the engine:

* Unicode characters are down-converted to ASCII (via [unidecode](https://github.com/FGRibreau/node-unidecode)).
	* Those that do not have ASCII equivalents are stripped off (e.g. Emoji).
* Only the following characters are allowed (everything else is stripped):
	* Alphanumerics
	* Dashes (hyphens)
	* Dots (periods)
	* Forward-slashes
* All alphanumeric characters are converted to lower-case.
* Duplicate adjacent slashes (i.e. "//") are converted to a single slash.
* Leading and trailing slashes are stripped.

So for example, this crazy key:

```
" / / / // HELLO-KEY @*#&^$*@/#&^$(*@#&^$ 😃  tést   / "
```

...is normalized to this:

```
"hello-key/test"
```

The same key normalization filter is applied when both storing and fetching records.

# Basic Functions

The storage module supports the following basic methods for typical operations.  Upon error, all callback methods are passed an `Error` object as the first argument.  If not, the first argument will be falsey (i.e. `false`, `0`, `null` or `undefined`), and the second argument will contain any requested data, if applicable.

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Storing Records

To store a record, call the [put()](docs/API.md#put) method.  Pass in a key, a value, and a callback.  The value may be an Object (which is automatically serialized to JSON), or a `Buffer` for a binary blob (see [Storing Binary Blobs](#storing-binary-blobs) below).  If the record doesn't exist, it is created, otherwise it is replaced.

```javascript
storage.put( 'test1', { foo: 'bar1' }, function(err) {
	if (err) throw err;
} );
```

## Fetching Records

To fetch a record, call the [get()](docs/API.md#get) method.  Pass in a key, and a callback.  The data returned will be parsed back into an Object if JSON, or a raw `Buffer` object will be returned for binary records.

```javascript
storage.get( 'test1', function(err, data) {
	if (err) throw err;
} );
```

If you try to fetch a nonexistent record, a special error object will be passed to your callback with its `code` property set to `NoSuchKey`.  This is a special case allowing you to easily differentiate a "record not found" error from another, more severe I/O error.  Example:

```javascript
storage.get( 'this_key_does_not_exist', function(err, data) {
	if (err) {
		if (err.code == 'NoSuchKey') {
			// record not found
		}
		else {
			// some other error
		}
	}
	else {
		// success, data will contain the record
	}
} );
```

Some engines also allow you to "head" (i.e. ping) an object to retrieve some metadata about it, without fetching the value.  To do this, call the [head()](docs/API.md#head) method, and pass in the key.  The metadata usually consists of the size (`len`) and last modification date (`mod`).  Example:

```javascript
storage.head( 'test1', function(err, data) {
	if (err) throw err;
	// data.mod
	// data.len
} );
```

Note that the [Couchbase](#couchbase) engine does not support `head`, but the [Amazon S3](#amazon-s3) and [Local Filesystem](#local-filesystem) engines both do.

You can fetch multiple records at once by calling `getMulti()` and passing in array of keys.  Example:

```javascript
storage.getMulti( ['test1', 'test2', 'test3'], function(err, values) {
	if (err) throw err;
	// values[0] will be the test1 record.
	// values[1] will be the test2 record.
	// values[2] will be the test3 record.
} );
```

## Copying Records

To make a copy of a record and store it under a new key, call the [copy()](docs/API.md#copy) method.  Pass in the old key, new key, and a callback.

```javascript
storage.copy( 'test1', 'test2', function(err) {
	if (err) throw err;
} );
```

**Note:** This is a compound function containing multiple sequential engine operations.  You may require locking depending on your application.  See [Advisory Locking](#advisory-locking) below.

## Renaming Records

To rename a record, call the [rename()](docs/API.md#rename) method.  Pass in the old key, new key, and a callback.

```javascript
storage.rename( 'test1', 'test2', function(err) {
	if (err) throw err;
} );
```

**Note:** This is a compound function containing multiple sequential engine operations.  You may require locking depending on your application.  See [Advisory Locking](#advisory-locking) below.

## Deleting Records

To delete a record, call the [delete()](docs/API.md#delete) method.  This is immediate and permanent.  Pass in the key, and a callback.

```javascript
storage.delete( 'test1', function(err) {
	if (err) throw err;
} );
```

# Storing Binary Blobs

To store a binary value, pass a filled `Buffer` object as the value, and specify a key ending in a "file extension", e.g. `.gif`.  The latter requirement is so the engine can detect which records are binary and which are JSON, just by looking at the key.  Example:

```javascript
var fs = require('fs');
var buffer = fs.readFileSync('picture.gif');
storage.put( 'test1.gif', buffer, function(err) {
	if (err) throw err;
} );
```

When fetching a binary record, a `Buffer` object will be passed to your callback:

```javascript
var fs = require('fs');
storage.get( 'test1.gif', function(err, buffer) {
	if (err) throw err;
	fs.writeFileSync('picture.gif', buffer);
} );
```

# Using Streams

You can store and fetch binary records using [streams](https://nodejs.org/api/stream.html), so as to not load any content into memory.  This can be used to manage extremely large files in a memory-limited environment.  Note that the record content is treated as binary, so the keys *must* contain file extensions.  To store an object using a readable stream, call the [putStream()](docs/API.md#putstream) method.  Similarly, to fetch a readable stream to a record, call the [getStream()](docs/API.md#getstream) method.

Example of storing a record by spooling the data from a file:

```js
var fs = require('fs');
var stream = fs.createReadStream('picture.gif');

storage.putStream( 'test1.gif', stream, function(err) {
	if (err) throw err;
} );
```

Example of fetching a read stream and spooling it to a file:

```js
var fs = require('fs');
var writeStream = fs.createWriteStream('/var/tmp/downloaded.gif');

storage.getStream( 'test1.gif', function(err, readStream) {
	if (err) throw err;
	writeStream.on('finish', function() {
		// data is completely written
	} );
	readStream.pipe( writeStream );
} );
```

Please note that not all the storage engines support streams natively, so the content may actually be loaded into RAM in the background.  Namely, as of this writing, the Couchbase and Redis APIs do not support streams, so they are currently simulated in those engines.  Streams *are* supported natively in both the Filesystem and Amazon S3 engines.

# Expiring Data

By default all records live indefinitely, and have no predetermined lifespan.  However, you can set an expiration date on any record, and it will be deleted on that day by the daily maintenance job (see [Daily Maintenance](#daily-maintenance) below).  Note that there is no support for an expiration *time*, but rather only a date.

To set the expiration date for a record, call the [expire()](docs/API.md#expire) method, passing in the key and the desired expiration date.  This function completes instantly and requires no callback.  The date argument can be a JavaScript `Date` object, any supported date string (e.g. `YYYY-MM-DD`), or Epoch seconds.  Example:

```javascript
storage.expire( 'test1', '2015-05-12' );
```

It is wasteful to call this multiple times for the same record and the same date.  It adds extra work for the maintenance job, as each call adds an event in a list that must be iterated over.  It should only be called once per record, or when extending the expiration date to a future day.

Please note that if you require the ability to update expiration dates on existing records, you must explicitly set the [expiration_updates](#expiration_updates) configuration property to `true`.  This activates additional internal bookkeeping, which keeps track of all current record expiration dates, so they can be efficiently updated.  Note that this does incur some additional overhead.

## Custom Record Types

You can register custom record types if they require special handling for deletion.  For example, your application may define its own record type that has other related records which must also be deleted.  Instead of setting separate expiration dates for all your related records, you can set one single expiration date on the primary record, and register it as a custom type.  Then, when the [daily maintenance](#daily-maintenance) runs, your custom handler function will be called for your custom records, and you can delete the all related records yourself.

Your custom records are identified by a special top-level `type` property in their JSON.  This property must be set to a unique string that you pre-register with the storage system at startup.  Note that only JSON records are supported for custom deletion -- binary records are not.

To register a custom record type, call the [addRecordType()](docs/API.md#addrecordtype) method, and pass in a custom type key (string), and an object containing key/value pairs for actions and handlers.  Currently only the `delete` action is defined, for handling maintenance (expiration) of your custom record type.  Example use:

```js
storage.addRecordType( 'my_custom_type', {
	delete: function(key, value, callback) {
		// custom handler function, called from daily maint for expired records
		// execute my own custom deletion routine here, then fire the callback
		callback();
	}
});
```

So the idea here is whenever the [daily maintenance](#daily-maintenance) job runs, and encounters JSON records with a `type` property set to `my_custom_type`, your custom handler function would be called to handle the deletes for the expired records.  This would happen instead of a typical call to [delete()](docs/API.md#delete), which is the default behavior.

# Advisory Locking

The storage system provides a simple, in-memory advisory locking mechanism.  All locks are based on a specified key, and can be exclusive or shared.  You can also choose to wait for a lock to be released by passing `true` as the 2nd argument, or fail immediately if the key is already locked by passing `false`.  To lock a key in exclusive mode, call [lock()](docs/API.md#lock), and to unlock it call [unlock()](docs/API.md#unlock).

Here is a simple use case:

```javascript
storage.lock( 'test1', true, function() {
	// key is locked, now we can fetch
	storage.get( key, function(err, data) {
		if (err) {
			storage.unlock('test1');
			throw err;
		}
		
		// increment counter
		data.counter++;
		
		// save back to storage
		storage.put( 'test1', data, function(err) {
			if (err) {
				storage.unlock('test1');
				throw err;
			}
			
			// and finally unlock
			storage.unlock('test1');
		} ); // put
	} ); // get
} ); // lock
```

The above example is a typical counter increment pattern using advisory locks.  The `test1` record is locked, fetched, its counter incremented, written back to disk, then finally unlocked.  The idea is, even though all the storage operations are async, all other requests for this record will block until the lock is released.  Remember that you always need to call `unlock()`, even if throwing an error.

In addition to exclusive locks, you can request a "shared" lock.  Shared locking allows multiple clients to access the key simultaneously.  For example, one could lock a key for reading using shared locks, but lock it for writing using an exclusive lock.  To lock a key in shared mode, call [shareLock()](docs/API.md#sharelock), and to unlock it call [shareUnlock()](docs/API.md#shareunlock).  Example:

```js
storage.shareLock( 'test1', true, function() {
	// key is locked, now we can fetch data safely
	storage.get( key, function(err, data) {
		storage.shareUnlock('test1');
		if (err) {
			throw err;
		}
	} ); // get
} ); // lock
```

Shared locks obey the following rules:

- If a key is already locked in exclusive mode, the shared lock waits for the exclusive lock to clear.
- If a key is already locked in shared mode, multiple clients are allowed to lock it simultaneously.
- If an exclusive lock is requested on a key that is locked in shared mode, the following occurs:
	- The exclusive lock must wait for all current shared clients to unlock.
	- Additional shared clients must wait until after the exclusive lock is acquired, and released.

Shared locks are used internally for accessing complex structures like lists, hashes and searching records in an index.

Please note that all locks are implemented in RAM, so they only exist in the current Node.js process.  This is really only designed for single-process daemons, and clusters with one master server doing writes.

# Logging

The storage library uses the logging system built into [pixl-server](https://github.com/jhuckaby/pixl-server#logging).  Essentially there is one combined "event log" which contains debug messages, errors and transactions (however, this can be split into multiple logs if desired).  The `component` column will be set to either `Storage`, or the storage engine Plugin (e.g. `Filesystem`).

In all these log examples the first 3 columns (`hires_epoch`, `date` and `hostname`) are omitted for display purposes.  The columns shown are `component`, `category`, `code`, `msg`, and `data`.

## Debug Logging

Log entries with the `category` set to `debug` are debug messages, and have a verbosity level from 1 to 10 (echoed in the `code` column).  Here is an example snippet, showing a hash being created and a key added:

```
[Storage][debug][9][Storing hash key: users: bsanders][]
[Storage][debug][9][Requesting lock: |users][]
[Storage][debug][9][Locked key: |users][]
[Storage][debug][9][Loading hash: users][]
[Filesystem][debug][9][Fetching Object: users][data/users.json]
[Storage][debug][9][Hash not found, creating it: users][]
[Storage][debug][9][Creating new hash: users][{"page_size":10,"length":0,"type":"hash"}]
[Filesystem][debug][9][Fetching Object: users][data/users.json]
[Filesystem][debug][9][Storing JSON Object: users][data/users.json]
[Filesystem][debug][9][Store operation complete: users][]
[Filesystem][debug][9][Storing JSON Object: users/data][data/users/data.json]
[Filesystem][debug][9][Store operation complete: users/data][]
[Filesystem][debug][9][Fetching Object: users/data][data/users/data.json]
[Filesystem][debug][9][JSON fetch complete: users/data][]
[Filesystem][debug][9][Storing JSON Object: users/data][data/users/data.json]
[Filesystem][debug][9][Store operation complete: users/data][]
[Filesystem][debug][9][Storing JSON Object: users][data/users.json]
[Filesystem][debug][9][Store operation complete: users][]
[Storage][debug][9][Unlocking key: |users (0 clients waiting)][]
```

## Error Logging

Errors have the `category` column set to `error`, and come with a `code` and `msg`, both strings.  Errors are typically things that should not ever occur, such as failures to read or write records.  Example:

```
[Filesystem][error][file][Failed to read file: bad/users: data/bad/users.json: EACCES: permission denied, open 'data/bad/users.json'][]
```

Other examples of errors include transaction commit failures and transaction rollbacks.

## Transaction Logging

Transactions (well, more specifically, all storage actions) are logged with the `category` column set to `transaction`.  The `code` column will be one of the following constants, denoting which action took place:

```
get, put, head, delete, expire_set, perf_sec, perf_min, commit, index, unindex, search, sort, maint
```

You can control which of these event types are logged, by including a `log_event_types` object in your storage configuration.  Include keys with true values for any log event types you want to see logged.  Example:

```js
log_event_types: { 
	get:0, put:1, head:0, delete:1, expire_set:1, perf_sec:1, perf_min:1,
	commit:1, index:1, unindex:1, search:0, sort:0, maint:1 
}
```

Alternatively, you can just set the `all` key to log all event types:

```js
log_event_types: { 
	all: 1
}
```

Finally, the `data` column will contain some JSON-formatted metadata about the event, always including the `elapsed_ms` (elapsed time in milliseconds), but often other information as well.

Here are some example transaction log entries:

```
[Storage][transaction][get][index/ontrack/summary/word/releas][{"elapsed_ms":1.971}]
[Storage][transaction][put][index/ontrack/created/sort/data][{"elapsed_ms":1.448}]
[Storage][transaction][commit][index/ontrack][{"id":"0f760e77075fdd18c8d39f88e76c1f5e","elapsed_ms":38.286,"actions":25}]
[Storage][transaction][index][index/ontrack][{"id":"2653","elapsed_ms":92.368}]
[Storage][transaction][search][index/ontrack][{"query":"(status = \"closed\" && summary =~ \"Released to Preproduction\")","elapsed_ms":14.206,"results":24}]
```

## Performance Logs

If your application has continuous storage traffic, you might be interested in logging aggregated performance metrics every second, and/or every minute.  These can be enabled by setting `perf_sec` and/or `perf_min` properties in the `log_event_types` configuration object, respectively:

```js
log_event_types: { 
	perf_sec: 1, 
	perf_min: 1
}
```

Performance metrics are logged with the `category` column set to `perf`.  The actual metrics are in JSON format, in the `data` column.  Here is an example performance log entry:

```
[Storage][perf][second][Last Second Performance Metrics][{"get":{"min":0.132,"max":8.828,"total":319.99,"count":249,"avg":1.285},"index":{"min":24.361,"max":31.813,"total":137.421,"count":5,"avg":27.484},"commit":{"min":16.693,"max":26.227,"total":105.538,"count":5,"avg":21.107},"put":{"min":0.784,"max":7.367,"total":198.952,"count":125,"avg":1.591}}]
```

That JSON data is the same format returned by the [getStats()](docs/API.md#getstats) method.  See below for details.

Note that performance metrics are only logged if there was at least one event.  If your application is completely idle, it will not log anything.

# Performance Metrics

If you want to fetch performance metrics on-demand, call the [getStats()](docs/API.md#getstats) method.  This returns an object containing a plethora of information, including min/avg/max metrics for all events.  Example response, formatted as JSON for display:

```js
{
	"version": "2.0.0",
	"engine": "Filesystem",
	"concurrency": 4,
	"transactions": true,
	"last_second": {
		"search": {
			"min": 14.306,
			"max": 14.306,
			"total": 14.306,
			"count": 1,
			"avg": 14.306
		},
		"get": {
			"min": 0.294,
			"max": 2.053,
			"total": 5.164,
			"count": 5,
			"avg": 1.032
		}
	},
	"last_minute": {},
	"recent_events": {
		"get": [
			{
				"date": 1519507643.523,
				"type": "get",
				"key": "index/ontrack/status/word/closed",
				"data": {
					"elapsed_ms": 1.795
				}
			},
			{
				"date": 1519507643.524,
				"type": "get",
				"key": "index/ontrack/summary/word/releas",
				"data": {
					"elapsed_ms": 2.053
				}
			}
		]
	},
	"locks": {}
}
```

Here are descriptions of the main elements:

| Property Name | Description |
|---------------|-------------|
| `version` | The current version of the `pixl-server-storage` module. |
| `engine` | The name of the current engine Plugin, e.g. `Filesystem`. |
| `concurrency` | The current concurrency setting (i.e. max threads). |
| `transactions` | Whether [transactions](docs/Transactions.md) are enabled (true) or disabled (false). |
| `last_second` | A performance summary of the last second (see below). |
| `last_minute` | A performance summary of the last minute (see below). |
| `recent_events` | The most recent N events (see below). |
| `locks` | Any storage keys that are currently locked (both exclusive and shared). |

The performance metrics (both `last_second` and `last_minute`) include minimums, averages, maximums, counts and totals for each event, and are provided in this format:

```js
{
	"search": {
		"min": 14.306,
		"max": 14.306,
		"total": 14.306,
		"count": 1,
		"avg": 14.306
	},
	"get": {
		"min": 0.294,
		"max": 2.053,
		"total": 5.164,
		"count": 5,
		"avg": 1.032
	}
}
```

All the measurements are in milliseconds, and represent any actions that took place over the last second or minute.

The `recent_events` object will only be populated if the `max_recent_events` configuration property is set to a positive number.  This will keep track of the last N events in each type, and provide them here.  This feature is disabled by default, as it incurs a small memory overhead for bookkeeping.

# Daily Maintenance

If you plan on expiring records for future deletion (see [Expiring Data](#expiring-data) above), you should enable the nightly maintenance job.  This will iterate over all the records that expired on the current day, and actually delete them.  To do this, set the [maintenance](#maintenance) key in your storage configuration, and set it to a `HH::MM` string:

```javascript
{
	"maintenance": "04:30" // run daily at 4:30 AM
}
```

This is mainly for daemons that run 24x7.  Also, there is no automated recovery if the server was down when the maintenance job was supposed to run.  So you may need to call `storage.runMaintenance()` manually for those rare cases, and pass in today's date (or the date when it should have ran), and a callback.

# Plugin Development

New engine plugins can easily be added.  All you need to do is create a class that implements a few standard API methods, and then load your custom engine using the [engine_path](#engine_path) configuration parameter.

Here are the API methods your class should define:

| API Method | Arguments | Description |
|--------|-----------|-------------|
| `startup()` | CALLBACK | Optional, called as the server starts up. Fire the callback when your engine is ready. |
| `put()` | KEY, VALUE, CALLBACK | Store the key/value pair, and then fire the callback. |
| `head()` | KEY, CALLBACK | Optional, fetch any metadata you may have about the record, and fire the callback. |
| `get()` | KEY, CALLBACK | Fetch the key, and pass the value to the callback. |
| `delete()` | KEY, CALLBACK | Delete the specified key, then fire the callback. |
| `shutdown()` | CALLBACK | Optional, called as the server shuts down. Fire the callback when your engine has stopped. |

It is recommended you use the [pixl-class](https://www.npmjs.com/package/pixl-class) class framework, and inherit from the `pixl-server/component` base class.  This implements some useful methods such as `logDebug()`.

Here is an example skeleton class you can start from:

```javascript
var Class = require("pixl-class");
var Component = require("pixl-server/component");

module.exports = Class.create({
	
	__name: 'MyEngine',
	__parent: Component,
	
	startup: function(callback) {
		// setup initial connection
		var self = this;
		this.logDebug(2, "Setting up MyEngine");
		callback();
	},
	
	put: function(key, value, callback) {
		// store record given key and value
		callback();
	},
	
	head: function(key, callback) {
		// retrieve metadata on record (mod, len)
		callback();
	},
	
	get: function(key, callback) {
		// fetch record value given key
		callback();
	},
	
	delete: function(key, callback) {
		// delete record
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down MyEngine");
		callback();
	}
	
});
```

# Unit Tests

To run the unit test suite, issue this command from within the module directory:

```
npm test
```

If you install the [pixl-unit](https://www.npmjs.com/package/pixl-unit) module globally, you can provide various command-line options, such as verbose mode:

```
pixl-unit test/test.js --verbose
```

This also allows you to specify an alternate test configuration file via the `--configFile` option.  Using this you can load your own test config, which may use a different engine (e.g. S3, Couchbase, etc.):

```
pixl-unit test/test.js --configFile /path/to/my/config.json
```

# License

**The MIT License (MIT)**

Copyright (c) 2015 - 2018 Joseph Huckaby.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
