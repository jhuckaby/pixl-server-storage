# API Reference

Here are all the public methods you can call in the storage class.  These examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)

<!-- toc -->
- [General Methods](#general-methods)
	* [put](#put)
	* [putMulti](#putmulti)
	* [putStream](#putstream)
	* [get](#get)
	* [getMulti](#getmulti)
	* [getBuffer](#getbuffer)
	* [getStream](#getstream)
	* [getStreamRange](#getstreamrange)
	* [head](#head)
	* [headMulti](#headmulti)
	* [delete](#delete)
	* [deleteMulti](#deletemulti)
	* [copy](#copy)
	* [rename](#rename)
	* [lock](#lock)
	* [unlock](#unlock)
	* [shareLock](#sharelock)
	* [shareUnlock](#shareunlock)
	* [expire](#expire)
	* [addRecordType](#addrecordtype)
	* [getStats](#getstats)
- [List Methods](#list-methods)
	* [listCreate](#listcreate)
	* [listPush](#listpush)
	* [listUnshift](#listunshift)
	* [listPop](#listpop)
	* [listShift](#listshift)
	* [listGet](#listget)
	* [listSplice](#listsplice)
	* [listFind](#listfind)
	* [listFindCut](#listfindcut)
	* [listFindReplace](#listfindreplace)
	* [listFindUpdate](#listfindupdate)
	* [listFindEach](#listfindeach)
	* [listInsertSorted](#listinsertsorted)
	* [listCopy](#listcopy)
	* [listRename](#listrename)
	* [listEach](#listeach)
	* [listEachPage](#listeachpage)
	* [listEachUpdate](#listeachupdate)
	* [listEachPageUpdate](#listeachpageupdate)
	* [listGetInfo](#listgetinfo)
	* [listDelete](#listdelete)
- [Hash Methods](#hash-methods)
	* [hashCreate](#hashcreate)
	* [hashPut](#hashput)
	* [hashPutMulti](#hashputmulti)
	* [hashGet](#hashget)
	* [hashGetMulti](#hashgetmulti)
	* [hashUpdate](#hashupdate)
	* [hashUpdateMulti](#hashupdatemulti)
	* [hashEach](#hasheach)
	* [hashEachSync](#hasheachsync)
	* [hashEachPage](#hasheachpage)
	* [hashGetAll](#hashgetall)
	* [hashCopy](#hashcopy)
	* [hashRename](#hashrename)
	* [hashDelete](#hashdelete)
	* [hashDeleteMulti](#hashdeletemulti)
	* [hashDeleteAll](#hashdeleteall)
	* [hashGetInfo](#hashgetinfo)
- [Transaction Methods](#transaction-methods)
	* [begin](#begin)
	* [commit](#commit)
	* [abort](#abort)
- [Indexer Methods](#indexer-methods)
	* [indexRecord](#indexrecord)
	* [unindexRecord](#unindexrecord)
	* [searchRecords](#searchrecords)
	* [sortRecords](#sortrecords)
	* [getFieldSummary](#getfieldsummary)
	* [searchSingle](#searchsingle)

# General Methods

## put

```javascript
storage.put( KEY, VALUE, CALLBACK );
```

The `put()` method stores a key/value pair.  It will create the record if it doesn't exist, or replace it if it does.  All keys should be strings.  The value may be an object or a `Buffer` (for binary blobs).  Objects are auto-serialized to JSON.  Your callback function is passed an error if one occurred.  Example:

```javascript
storage.put( 'test1', { foo: 'bar1' }, function(err) {
	if (err) throw err;
} );
```

For binary values, the key *must* contain a file extension, e.g. `test1.gif`.  Example:

```javascript
var fs = require('fs');
var buffer = fs.readFileSync('picture.gif');
storage.put( 'test1.gif', buffer, function(err) {
	if (err) throw err;
} );
```

## putMulti

```javascript
storage.putMulti( RECORDS, CALLBACK );
```

The `putMulti()` method stores multiple keys/values at once, from a specified object containing both.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than storing the records in sequence.  Example:

```javascript
var records = {
	multi1: { fruit: 'apple' },
	multi2: { fruit: 'orange' },
	multi3: { fruit: 'banana' }
};
storage.putMulti( records, function(err) {
	if (err) throw err;
} );
```

Note that if any of the individual put operations fail, the entire `putMulti()` function is aborted, and the first error is passed to your callback.  At this point the operation may have been partially successful, with some records written, and others not.  Due to this uncertainty, you may want to use this method inside of a [transaction](./Transactions.md), which can be safely rolled back upon error.

## putStream

```javascript
storage.putStream( KEY, STREAM, CALLBACK );
```

The `putStream()` method stores a record using a [readable stream](https://nodejs.org/api/stream.html#stream_class_stream_readable), so it doesn't have to be read into memory.  This can be used to spool very large files to storage without using any RAM.  Note that this is treated as a binary record, so the key *must* contain a file extension, e.g. `test1.gif`.  Example:

```javascript
var fs = require('fs');
var stream = fs.createReadStream('picture.gif');
storage.putStream( 'test1.gif', stream, function(err) {
	if (err) throw err;
} );
```

Please note that as of this writing, the `Couchbase`, `Redis` and `RedisCluster` engines have no native stream API, so the `putStream()` method has to load the entire record into memory.

## get

```javascript
storage.get( KEY, CALLBACK );
```

The `get()` method fetches a value given a key.  If the record is an object, it will be returned as such.  Or, if the record is a binary blob, a `Buffer` object will be returned.  Your callback function is passed an error if one occurred, and the data value for the given record.  Example:

```javascript
storage.get( 'test1', function(err, data) {
	if (err) throw err;
} );
```

## getMulti

```javascript
storage.getMulti( KEYS, CALLBACK );
```

The `getMulti()` method fetches multiple values at once, from a specified array of keys.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than fetching the records in sequence.  Your callback function is passed an array of values which correspond to the specified keys.  Example:

```javascript
storage.getMulti( ['test1', 'test2', 'test3'], function(err, values) {
	if (err) throw err;
	// values[0] will be the test1 record.
	// values[1] will be the test2 record.
	// values[2] will be the test3 record.
} );
```

Note that if *any* of the records fail, the entire operation fails, and the first error is passed to your callback.

## getBuffer

```javascript
storage.getBuffer( KEY, CALLBACK );
```

The `getBuffer()` method retrieves a [Buffer](https://nodejs.org/api/buffer.html) to a given record's data, regardless if the key points to a JSON record or a binary record.  Your callback function is passed an error if one occurred, and the buffer value for the given record.  Example:

```javascript
storage.getBuffer( 'test1', function(err, buf) {
	if (err) throw err;
} );
```

## getStream

```javascript
storage.getStream( KEY, CALLBACK );
```

The `getStream()` method retrieves a [readable stream](https://nodejs.org/api/stream.html#readable-streams) to a given record's data, so it can be read or piped to a writable stream.  This is for very large records, so nothing is loaded into memory.  Example of spooling to a local file:

```javascript
var fs = require('fs');
var writeStream = fs.createWriteStream('/var/tmp/downloaded.gif');

storage.getStream( 'test1.gif', function(err, readStream, info) {
	if (err) throw err;
	writeStream.on('finish', function() {
		// data is completely written
	} );
	readStream.pipe( writeStream );
} );
```

As you can see above, your callback is also passed a 3rd argument, which is an object containing the record's full byte length and modification date.  These properties match those returned when you call [head()](#head) (i.e. `len` and `mod`).

Please note that as of this writing, the `Couchbase`, `Redis` and `RedisCluster` engines have no native stream API, so the `getStream()` method has to load the entire record into memory.

## getStreamRange

```javascript
storage.getStreamRange( KEY, START, END, CALLBACK );
```

The `getStreamRange()` method retrieves a [readable stream](https://nodejs.org/api/stream.html#class-streamreadable) to a specific slice of a record's data, so it can be read or piped to a writable stream.  The `start` and `end` arguments should be set to the starting and ending byte offset of the slice you want.  Both values are *inclusive*.  Example of spooling bytes `0-99` of a record to a local file:

```javascript
var fs = require('fs');
var writeStream = fs.createWriteStream('/var/tmp/downloaded.gif');

storage.getStreamRange( 'test1.gif', 0, 99, function(err, readStream, info) {
	if (err) throw err;
	writeStream.on('finish', function() {
		// data is completely written
	} );
	readStream.pipe( writeStream );
} );
```

As you can see in the example above, your callback is also passed a 3rd argument, which is an object containing the record's full byte length and modification date.  These properties match those returned when you call [head()](#head) (i.e. `len` and `mod`).  The `len` is not affected by the `start` and `end` range -- it is always the full byte length of the record.

The API supports two special range cases:

- If `start` is valid but `end` is `NaN`, it is assumed you want the entire record starting at `start` offset.
- If `start` is `NaN` but `end` is valid, it is assumed you want `end` bytes from the end of the record.

Please note that as of this writing, the `Couchbase`, `Redis` and `RedisCluster` engines have no native stream API, so the `getStreamRange()` method has to load the entire record into memory.

## head

```javascript
storage.head( KEY, CALLBACK );
```

The `head()` method fetches metadata about an object given a key, without fetching the object itself.  This generally means that the object size, and last modification date are retrieved, however this is engine specific.  Your callback function will be passed an error if one occurred, and an object containing at least two keys:

| Key | Description |
| --- | ----------- |
| `mod` | The last modification date of the object, in Epoch seconds. |
| `len` | The size of the object value in bytes. |

Example:

```javascript
storage.head( 'test1', function(err, data) {
	if (err) throw err;
	// data.mod
	// data.len
} );
```

Please note that as of this writing, the `Couchbase`, `Redis` and `RedisCluster` engines have no native head API, so the `head()` method has to load the entire record.  It does return the record size in to the `len` property, but there is no way to retrieve the last modified date.

## headMulti

```javascript
storage.headMulti( KEYS, CALLBACK );
```

The `headMulti()` method pings multiple records at once, from a specified array of keys.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than pinging the records in sequence.  Your callback function is passed an array of values which correspond to the specified keys.  Example:

```javascript
storage.headMulti( ['test1', 'test2', 'test3'], function(err, values) {
	if (err) throw err;
	// values[0] will be the test1 head info.
	// values[1] will be the test2 head info.
	// values[2] will be the test3 head info.
} );
```

## delete

```javascript
storage.delete( KEY, CALLBACK );
```

The `delete()` method deletes an object given a key.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.delete( 'test1', function(err) {
	if (err) throw err;
} );
```

## deleteMulti

```javascript
storage.deleteMulti( KEYS, CALLBACK );
```

The `deleteMulti()` method deletes multiple records at once, from a specified array of keys.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than deleting the records in sequence.  Example:

```javascript
storage.deleteMulti( ['test1', 'test2', 'test3'], function(err) {
	if (err) throw err;
} );
```

## copy

```javascript
storage.copy( OLD_KEY, NEW_KEY, CALLBACK );
```

The `copy()` method copies a value from one key and stores it at another.  If the destination record doesn't exist it is created, otherwise it is replaced.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.copy( 'test1', 'test2', function(err) {
	if (err) throw err;
} );
```

**Note:** This is a compound function containing multiple sequential engine operations (in this case a `get` and a `put`).  You may require locking depending on your application.  See [lock()](#lock) and [unlock()](#unlock) below.

## rename

```javascript
storage.rename( OLD_KEY, NEW_KEY, CALLBACK );
```

The `rename()` method copies a value from one key, stores it at another, and deletes the original key.  If the destination record doesn't exist it is created, otherwise it is replaced.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.rename( 'test1', 'test2', function(err) {
	if (err) throw err;
} );
```

**Note:** This is a compound function containing multiple sequential engine operations (in this case a `get`, `put` and `delete`).  You may require locking depending on your application.  See [lock()](#lock) and [unlock()](#unlock) below.

## lock

```javascript
storage.lock( KEY, WAIT, CALLBACK );
```

The `lock()` method implements an in-memory advisory locking system, where you can request an exclusive lock on a particular key, and optionally wait for it to be unlocked.  It is up to you to call [unlock()](#unlock) for every record that you lock, even in the case of an error.

If you pass `true` for the wait argument and the specified record is already locked, your request is added to a queue and invoked in a FIFO manner.  If you pass `false` and the resource is locked, an error is passed to your callback immediately.

## unlock

```javascript
storage.unlock( KEY );
```

The `unlock()` method releases an exclusive lock on a particular record, specified by its key.  This is a synchronous function with no callback.  For a usage example, see [Advisory Locking](../README.md#advisory-locking).

## shareLock

```javascript
storage.shareLock( KEY, WAIT, CALLBACK );
```

The `shareLock()` method implements an in-memory advisory locking system, where you can request a shared lock on a particular key, and optionally wait for it to be unlocked.  Multiple clients may lock the same key in shared mode.  It is up to you to call [shareUnlock()](#shareunlock) for every record that you lock, even in the case of an error.

If you pass `true` for the wait argument and the specified record is already locked, your request is added to a queue and invoked in a FIFO manner.  If you pass `false` and the resource is locked, an error is passed to your callback immediately.

## shareUnlock

```javascript
storage.shareUnlock( KEY );
```

The `shareUnlock()` method releases a shared lock on a particular record, specified by its key.  This is a synchronous function with no callback.  For a usage example, see [Advisory Locking](../README.md#advisory-locking).

## expire

```javascript
storage.expire( KEY, DATE );
```

The `expire()` method sets an expiration date on a record given its key.  The date can be any string, Epoch seconds or `Date` object.  The daily maintenance system will automatically deleted all expired records when it runs (assuming it is enabled -- see [Daily Maintenance](../README.md#daily-maintenance)).  Example:

```javascript
var exp_date = ((new Date()).getTime() / 1000) + 86400; // tomorrow
storage.expire( 'test1', exp_date );
```

The earliest you can set a record to expire is the next day, as the maintenance script only runs once per day, typically in the early morning, and it only processes records expiring on the current day.

## addRecordType

```js
storage.addRecordType( TYPE, HANDLERS );
```

The `addRecordType()` method registers a custom record type, for deletion via the daily maintenance system.  Your custom records are identified by a `type` property set to a unique string which you register a handler for.  Then, your handler is called to delete expired records of your defined types.  Example use:

```js
storage.addRecordType( 'my_custom_type', {
	delete: function(key, value, callback) {
		// custom handler function, called from daily maint for expired records
		// execute my own custom deletion routine here, then fire the callback
		callback();
	}
});
```

See [Custom Record Types](../README.md#custom-record-types) for more details.

## getStats

```js
storage.getStats();
```

The `getStats()` method returns information about current system performance, including min/avg/max metrics for the last second and minute.  It takes no arguments, and returns an object containing the following:

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
	"recent_events": {},
	"locks": {}
}
```

For details on these stats, see [Performance Metrics](../README.md#performance-metrics).

# List Methods

## listCreate

```javascript
storage.listCreate( KEY, OPTIONS, CALLBACK );
```

The `listCreate()` method creates a new, empty list.  Specify the desired key, options (see below) and a callback function.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listCreate( 'list1', {}, function(err) {
	if (err) throw err;
} );
```

Unless otherwise specified, the list will be created with the default [page size](../README.md#list_page_size) (number of items per page).  However, you can override this in the options object by passing a `page_size` property:

```javascript
storage.listCreate( 'list1', { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

## listPush

```javascript
storage.listPush( KEY, ITEMS, [OPTIONS], CALLBACK );
```

Similar to the standard [Array.push()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/push), the `listPush()` method pushes one or more items onto the end of a list.  The list will be created if it doesn't exist, using the default [page size](../README.md#list_page_size).  `ITEMS` can be a single object, or an array of objects.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listPush( 'list1', { username: 'jhuckaby', age: 38 }, function(err) {
	if (err) throw err;
} );
```

If the list doesn't exist, `listPush()` will create it.  If you specify an `OPTIONS` object, this will be used in the creation of the list, i.e. to specify the [page size](../README.md#list_page_size), and add any custom params you want.

```javascript
storage.listPush( 'list1', { username: 'jhuckaby', age: 38 }, { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

## listUnshift

```javascript
storage.listUnshift( KEY, ITEMS, CALLBACK );
```

Similar to the standard [Array.unshift()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/unshift), the `listUnshift()` method unshifts one or more items onto the beginning of a list.  The list will be created if it doesn't exist, using the default [page size](../README.md#list_page_size).  `ITEMS` can be a single object, or an array of objects.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listUnshift( 'list1', { username: 'jhuckaby', age: 38 }, function(err) {
	if (err) throw err;
} );
```

If the list doesn't exist, `listUnshift()` will create it.  If you specify an `OPTIONS` object, this will be used in the creation of the list, i.e. to specify the [page size](../README.md#list_page_size), and add any custom params you want.

```javascript
storage.listUnshift( 'list1', { username: 'jhuckaby', age: 38 }, { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

## listPop

```javascript
storage.listPop( KEY, CALLBACK );
```

Similar to the standard [Array.pop()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/pop), the `listPop()` method pops one single item off the end of a list, and returns it.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be the popped item, if successful.  Example:

```javascript
storage.listPop( 'list1', function(err, item) {
	if (err) throw err;
} );
```

If the list is empty, an error is not generated, but the item will be `null`.

## listShift

```javascript
storage.listShift( KEY, CALLBACK );
```

Similar to the standard [Array.shift()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/shift), the `listShift()` method shifts one single item off the beginning of a list, and returns it.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be the shifted item, if successful.  Example:

```javascript
storage.listShift( 'list1', function(err, item) {
	if (err) throw err;
} );
```

If the list is empty, an error is not generated, but the item will be `null`.

## listGet

```javascript
storage.listGet( KEY, INDEX, LENGTH, CALLBACK );
```

The `listGet()` method fetches one or more items from a list, given the key, the starting index number (zero-based), the number of items to fetch (defaults to the entire list), and a callback.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be an array of the fetched items, if successful.  Example:

```javascript
storage.listGet( 'list1', 40, 5, function(err, items) {
	if (err) throw err;
} );
```

This would fetch 5 items starting at item index 40 (zero-based).

You can specify a negative index number to fetch items from the end of the list.  For example, to fetch the last 3 items in the list, use `-3` as the index, and `3` as the length.

Your callback function is also passed the list info object as a 3rd argument, in case you need to know the list length, page size, or first/last page positions.

## listSplice

```javascript
storage.listSplice( KEY, INDEX, LENGTH, NEW_ITEMS, CALLBACK );
```

Similar to the standard [Array.splice()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice), the `listSplice()` method removes a chunk of items from a list, optionally replacing it with a new chunk of items.  You must specify the list key, the index number of the first item to remove (zero-based), the number of items to remove (can be zero), an array of replacement items (can be empty or null), and finally a callback.

Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be an array of the removed items, if successful.  Example:

```javascript
storage.listSplice( 'list1', 40, 5, [], function(err, items) {
	if (err) throw err;
} );
```

This example would remove 5 items starting at item index 40, and replace with nothing (no items inserted).  The list size would shrink by 5, and the spliced items would be passed to your callback in an array.

## listFind

```javascript
storage.listFind( KEY, CRITERIA, CALLBACK );
```

The `listFind()` method will search a list for a particular item, based on a criteria object, and return the first item found to your callback.  The criteria object may have one or more key/value pairs, which must *all* match a list item for it to be selected.  Criteria values may be any JavaScript primitive (string, number, etc.), or a regular expression object for more complex matching.

Your callback function is passed an error if one occurred, otherwise it'll be falsey.  If an item was found matching your criteria, the second argument will be the item itself, and the 3rd argument will be the item's index number (zero-based).  Example:

```javascript
storage.listFind( 'list1', { username: 'jhuckaby' }, function(err, item, idx) {
	if (err) throw err;
} );
```

If an item is not found, no error is generated.  However, the `item` will be null, and the `idx` will be `-1`.

## listFindCut

```javascript
storage.listFindCut( KEY, CRITERIA, CALLBACK );
```

The `listFindCut()` method will search a list for a particular item based on a criteria object, and if found, it'll delete it (remove it from the list using [listSplice()](#listsplice)).  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  If an item was found matching your criteria, the second argument will be the item itself.  Example:

```javascript
storage.listFindCut( 'list1', { username: 'jhuckaby' }, function(err, item) {
	if (err) throw err;
} );
```

## listFindReplace

```javascript
storage.listFindReplace( KEY, CRITERIA, NEW_ITEM, CALLBACK );
```

The `listFindReplace()` method will search a list for a particular item based on a criteria object, and if found, it'll replace it with the specified item.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
var criteria = { username: 'jhuckaby' };
var new_item = { username: 'huckabyj', foo: 'bar' };

storage.listFindReplace( 'list1', criteria, new_item, function(err) {
	if (err) throw err;
} );
```

## listFindUpdate

```javascript
storage.listFindUpdate( KEY, CRITERIA, UPDATES, CALLBACK );
```

The `listFindUpdate()` method will search a list for a particular item based on a criteria object, and if found, it'll "update" it with the keys/values specified.  Meaning, they are merged in with the existing item, adding new keys or replacing existing ones.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  If an item was found matching your criteria, the second argument will be the item itself, with all the updates applied.  Example:

```javascript
var criteria = { username: 'jhuckaby' };
var updates = { gender: 'male', age: 38 };

storage.listFindUpdate( 'list1', criteria, updates, function(err, item) {
	if (err) throw err;
} );
```

You can also increment or decrement numerical properties with this function.  If an item key exists and is a number, you can set any update key to a string prefixed with `+` (increment) or `-` (decrement), followed by the delta number (int or float), e.g. `+1`.  So for example, imagine a list of users, and an item property such as `number_of_logins`.  When a user logs in again, you could increment this counter like this:

```javascript
var criteria = { username: 'jhuckaby' };
var updates = { number_of_logins: "+1" };

storage.listFindUpdate( 'list1', criteria, updates, function(err, item) {
	if (err) throw err;
} );
```

## listFindEach

```javascript
storage.listFindEach( KEY, CRITERIA, ITERATOR, CALLBACK );
```

The `listFindEach()` method will search a list for a *all* items that match a criteria object, and fire an iterator function for each one.  The criteria object may have one or more key/value pairs, which must all match a list item for it to be selected.  Criteria values may be any JavaScript primitive (string, number, etc.), or a regular expression object for more complex matching. 

Your `ITERATOR` function is passed the item, the item index number, and a special callback function which must be called when you are done with the current item.  Pass it an error if you want to prematurely abort the loop, and jump to the final callback (the error will be passed through to it).  Otherwise, pass nothing to the iterator callback, to notify all is well and you want the next matched item.

Your `CALLBACK` function is called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.listFindEach( 'list1', { username: 'jhuckaby' }, function(item, idx, callback) {
	// do something with item, then fire callback
	callback();
}, 
function(err) {
	if (err) throw err;
	// all matched items iterated over
} );
```

## listInsertSorted

```javascript
storage.listInsertSorted( KEY, ITEM, COMPARATOR, CALLBACK );
```

The `listInsertSorted()` method inserts an item into a list, while keeping it sorted.  It doesn't resort the entire list every time, but rather it locates the correct position to insert the one item, based on sorting criteria, then performs a splice to insert it into place.  Example:

```javascript
var new_user = {
	username: 'jhuckaby', 
	age: 38, 
	gender: 'male' 
};

var comparator = function(a, b) {
	return( (a.username < b.username) ? -1 : 1 );
};

storage.listInsertSorted( 'users', new_user, comparator, function(err) {
	if (err) throw err;
	// item inserted successfully
} );
```

If your sorting criteria is simple, i.e. a single top level property sorted ascending or descending, you can specify an array containing the key to sort by, and a direction (`1` for ascending, `-1` for descending), instead of a comparator function.  Example:

```javascript
storage.listInsertSorted( 'users', new_user, ['username', 1], function(err) {
	if (err) throw err;
} );
```

## listCopy

```javascript
storage.listCopy( OLD_KEY, NEW_KEY, CALLBACK );
```

The `listCopy()` method copies a list and all its items to a new key.  Specify the existing list key, a new key, and a callback.  If anything exists at the destination key, it is clobbered.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listCopy( 'list1', 'list2', function(err) {
	if (err) throw err;
} );
```

If a list already exists at the destination key, you should delete it first.  It will be overwritten, but if the new list has differently numbered pages, some of the old list pages may still exist and occupy space, detached from their old parent list.  So it is always safest to delete first.

## listRename

```javascript
storage.listRename( OLD_KEY, NEW_KEY, CALLBACK );
```

The `listRename()` method renames (moves) a list and all its items to a new key.  Specify the existing list key, a new key, and a callback.  If anything exists at the destination key, it is clobbered.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listRename( 'list1', 'list2', function(err) {
	if (err) throw err;
} );
```

If a list already exists at the destination key, you should delete it first.  It will be overwritten, but if the new list has differently numbered pages, some of the old list pages may still exist and occupy space, detached from their old parent list.  So it is always safest to delete first.

## listEach

```javascript
storage.listEach( KEY, ITERATOR, CALLBACK );
```

The `listEach()` method iterates over a list one item at a time, invoking your `ITERATOR` function for each item.  This is similar to how the [async eachSeries()](http://caolan.github.io/async/docs.html#.eachSeries) method works (in fact, it is used internally for each list page).  The list pages are loaded one at a time, as to not fill up memory with huge lists.

Your iterator function is passed the item, the item index number, and a special callback function which must be called when you are done with the current item.  Pass it an error if you want to prematurely abort the loop, and jump to the final callback (the error will be passed through to it).  Otherwise, pass nothing to the iterator callback, to notify all is well and you want the next item in the list.

Your `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.listEach( 'list1', function(item, idx, callback) {
	// do something with item, then fire callback
	callback();
}, 
function(err) {
	if (err) throw err;
	// all items iterated over
} );
```

## listEachPage

```javascript
storage.listEachPage( KEY, ITERATOR, CALLBACK );
```

The `listEachPage()` method iterates over a list one *page* at a time, invoking your `ITERATOR` function for each page.  The list pages are loaded one at a time, as to not fill up memory with huge lists.

Your iterator function is passed each page's items as an array, and a special callback function which must be called when you are done with the current page.  Pass it an error if you want to prematurely abort the loop, and jump to the final callback (the error will be passed through to it).  Otherwise, pass nothing to the iterator callback, to notify all is well and you want the next page in the list.

Your `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.listEachPage( 'list1', function(items, callback) {
	// do something with items, then fire callback
	callback();
}, 
function(err) {
	if (err) throw err;
	// all items iterated over
} );
```

## listEachUpdate

```javascript
storage.listEachUpdate( KEY, ITERATOR, CALLBACK );
```

The `listEachUpdate()` method iterates over a list one item at a time, invoking your `ITERATOR` function for each item.  You can then choose to update any of the items, which will be written back to storage.  The list pages are loaded one at a time, as to not fill up memory with huge lists.

Your iterator function is passed the item, the item index number, and a special callback function which must be called when you are done with the current item.  The iterator callback accepts two arguments, an error (or something false for success), and a boolean which should be set to `true` if you made changes.  The storage engine uses this to decide which list pages require updating.

Your `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.listEachUpdate( 'list1', function(item, idx, callback) {
	// do something with item, then fire callback
	item.something = "something new!";
	callback(null, true);
}, 
function(err) {
	if (err) throw err;
	// all items iterated over
} );
```

## listEachPageUpdate

```javascript
storage.listEachPageUpdate( KEY, ITERATOR, CALLBACK );
```

The `listEachPageUpdate()` method iterates over a list one *page* at a time, invoking your `ITERATOR` function for each page.  You can then choose to update any of the items, which will be written back to storage.  The list pages are loaded one at a time, as to not fill up memory with huge lists.

Your iterator function is passed each page's items as an array, and a special callback function which must be called when you are done with the current page.  The iterator callback accepts two arguments, an error (or something false for success), and a boolean which should be set to `true` if you made changes to any items on the current page.  The storage engine uses this to decide which list pages require updating.

Your `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.listEachPageUpdate( 'list1', function(items, callback) {
	// do something with items, then fire callback
	items.forEach( function(item) {
		item.something = "something new!";
	} );
	callback(null, true);
}, 
function(err) {
	if (err) throw err;
	// all items iterated over
} );
```

## listGetInfo

```javascript
storage.listGetInfo( KEY, CALLBACK );
```

The `listGetInfo()` method retrieves information about the list, without loading any items.  Specifically, it fetches the list length, first and last page numbers, page size, and any custom keys you passed to the `OPTIONS` object when first creating the list.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be the list info object, if successful.  Example:

```javascript
storage.listGetInfo( 'list1', function(err, list) {
	if (err) throw err;
} );
```

Here are the keys you can expect to see in the info object:

| Key | Description |
|-----|-------------|
| `type` | Type of record, will be `list`. |
| `length` | Total number of items in the list. |
| `first_page` | Number of the first page in the list. |
| `last_page` | Number of the last page in the list. |
| `page_size` | Number of items per page. |

## listDelete

```javascript
storage.listDelete( KEY, ENTIRE, CALLBACK );
```

The `listDelete()` method deletes a list.  If you pass `true` for the second argument, the *entire* list will be deleted, including the header (options, page size, etc.).  Otherwise the list will simply be "cleared" (all items deleted).  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.listDelete( 'list1', true, function(err) {
	if (err) throw err;
} );
```

# Hash Methods

## hashCreate

```javascript
storage.hashCreate( PATH, OPTIONS, CALLBACK );
```

The `hashCreate()` method creates a new, empty hash.  Specify the desired path, options (see below) and a callback function.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.hashCreate( 'hash1', {}, function(err) {
	if (err) throw err;
} );
```

Unless otherwise specified, the hash will be created with the default [page size](../README.md#hash_page_size) (number of items per page).  However, you can override this in the options object by passing a `page_size` property:

```javascript
storage.hashCreate( 'hash1', { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

## hashPut

```javascript
storage.hashPut( PATH, KEY, VALUE, [OPTIONS], CALLBACK );
```

The `hashPut()` method stores a single key/value pair in a hash.  The `PATH` specifies the main storage path of the hash, and the hash key itself is identified by `KEY`, which should be a string.  The `VALUE` must be an object, serializable by JSON.

```javascript
storage.hashPut( 'users', 'bsanders', { name: 'Bernie', age: 75 }, function(err) {
	if (err) throw err;
} );
```

If the hash doesn't exist, `hashPut()` will create it.  If you specify an `OPTIONS` object, this will be used in the creation of the hash, i.e. to specify the [page size](../README.md#hash_page_size), and add any custom params you want.

```javascript
storage.hashPut( 'users', 'bsanders', { name: 'Bernie', age: 75 }, { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

## hashPutMulti

```javascript
storage.hashPutMulti( PATH, RECORDS, [OPTIONS], CALLBACK );
```

The `hashPutMulti()` method stores multiple key/value pairs in a hash.  The `PATH` specifies the main storage path of the hash, and `RECORDS` should be an object containing all the keys and values you want to store.

```js
var records = {
	"bsanders": { name: "Bernie", age: 75 },
	"hclinton": { name: "Hillary", age: 68 },
	"dtrump": { name: "Donald", age: 70 }
};

storage.hashPutMulti( 'users', records, function(err) {
	if (err) throw err;
} );
```

If the hash doesn't exist, `hashPutMulti()` will create it.  If you specify an `OPTIONS` object, this will be used in the creation of the hash, i.e. to specify the [page size](../README.md#hash_page_size), and add any custom params you want.

## hashGet

```javascript
storage.hashGet( PATH, KEY, CALLBACK );
```

The `hashGet()` method fetches a single value from a hash.  The `PATH` specifies the main storage path of the hash, and the hash key itself is identified by `KEY`, which should be a string.  Your callback will be passed an error object (falsey on success), and the desired hash value.

```javascript
storage.hashGet( 'users', 'bsanders', function(err, value) {
	if (err) throw err;
} );
```

## hashGetMulti

```javascript
storage.hashGetMulti( PATH, KEYS, CALLBACK );
```

The `hashGetMulti()` method fetches multiple hash values at once, from a specified `PATH` and array of hash `KEYS`.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than fetching the values in sequence.  Your callback function is passed an array of values which correspond to the specified keys.  Example:

```javascript
storage.hashGetMulti( 'users', ['bsanders', 'hclinton', 'dtrump'], function(err, values) {
	if (err) throw err;
	// values[0] will be the bsanders record.
	// values[1] will be the hclinton record.
	// values[2] will be the dtrump record.
} );
```

## hashUpdate

```javascript
storage.hashUpdate( PATH, KEY, UPDATES, CALLBACK );
```

The `hashUpdate()` method updates an existing key/value pair in a hash.  The `PATH` specifies the main storage path of the hash, and the hash key itself is identified by `KEY`, which should be a string.  The `UPDATES` must be an object, but it can contain sparse keys.  Furthermore, it can contain dot or slash delimited paths, to update inner nested keys.  The updates are essentially applied atop the exiting record, merging and replacing (overwriting) where appropriate.  Example:

```javascript
storage.hashUpdate( 'users', 'bsanders', { age: 81 }, function(err) {
	if (err) throw err;
} );
```

This would update Bernie's age to 81 without affecting any of the other properties in his user record.

## hashUpdateMulti

```javascript
storage.hashUpdateMulti( PATH, RECORDS, CALLBACK );
```

The `hashUpdateMulti()` method updates multiple key/value pairs in a hash.  The `PATH` specifies the main storage path of the hash, and `RECORDS` should be an object containing all the keys and values you want to update.  See [hashUpdate()](#hashupdate) for details on the update format.

```js
var updates = {
	"bsanders": { age: 81 },
	"hclinton": { age: 75 },
	"dtrump": { age: 77 }
};

storage.hashUpdateMulti( 'users', records, function(err) {
	if (err) throw err;
} );
```

This would update the `age` properties in each record, without affecting the other data.

## hashEach

```javascript
storage.hashEach( PATH, ITERATOR, CALLBACK );
```

The `hashEach()` method iterates over a hash one key at a time (in undefined order), invoking your `ITERATOR` function for each key/value pair.  The iterator is invoked in an asynchronous manner, requiring a callback to be called for every loop iteration (similar to [async eachSeries()](http://caolan.github.io/async/docs.html#.eachSeries)).  The hash pages are loaded one at a time, so we use as little memory as possible.

Your iterator function is passed the key and value of the current item, and a callback reference.  If you pass an error to the iterator callback it will abort the loop and proceed directly to the end (firing the final `CALLBACK` function).

The `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.hashEach( 'users', function(key, value, callback) {
	// do something with key/value
	callback();
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

## hashEachSync

```javascript
storage.hashEachSync( PATH, ITERATOR, CALLBACK );
```

The `hashEachSync()` method iterates over a hash one key at a time (in undefined order), invoking your `ITERATOR` function for each key/value pair.  The iterator is invoked in a synchronous manner, i.e. continuing as soon as it returns (similar to [Array.forEach()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach)).  The hash pages are loaded one at a time, so we use as little memory as possible.

Your iterator function is passed the key and value of the current item.  If you return `false` it will abort the loop and proceed directly to the end (firing the `CALLBACK` function).

The `CALLBACK` function is finally called when the loop is complete and all items were iterated over, or an error occurred somewhere in the middle.  It is passed an error object, or something falsey for success.  Example:

```javascript
storage.hashEach( 'users', function(key, value) {
	// do something with key/value
	// no callback here
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

## hashEachPage

```javascript
storage.hashEachPage( PATH, ITERATOR, CALLBACK );
```

The `hashEachPage()` method iterates over a hash one *page* at a time, invoking `ITERATOR` with *all* the keys and values in each page.  This differs from [hashEach()](#hasheach) in that your iterator is only fired once per page, as opposed to once per key.  This reduces overhead, making this the fastest way to iterate over a large hash.  The other difference is that your iterator is invoked in an asynchronous manner, i.e. it must fire a callback to continue (similar to [async eachSeries()](http://caolan.github.io/async/docs.html#.eachSeries)).

Your iterator is passed exactly two arguments.  An object containing all the keys and values in the current page (this may contain up to [page size](../README.md#hash_page_size) items), and a callback function that you must fire to continue the loop.  Pass an error into the callback to abort the loop anywhere in the middle.  The final `CALLBACK` is fired when all keys are iterated over, or an error occurs.

```javascript
storage.hashEachPage( 'users', function(items, callback) {
	// do something with page of items
	for (var key in items) {
		var value = items[key];
		// do something with key/value pair
	}
	
	// fire callback to continue to next page
	callback();
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

## hashGetAll

```javascript
storage.hashGetAll( PATH, CALLBACK );
```

The `hashGetAll()` method loads a hash entirely into memory as fast as possible, and fires your callback with a single in-memory object containing *all* the key/value pairs.  Please use this with caution on large hashes, and keep track of your process memory usage.  The `CALLBACK` is fired with two arguments: an error if one occurred (falsey if not), and a hash object containing all your keys and values.

```javascript
storage.hashGetAll( 'users', function(err, items) {
	if (err) throw err;
	
	// do something with all items
	for (var key in items) {
		var value = items[key];
		// do something with key/value pair
	}
} );
```

## hashCopy

```javascript
storage.hashCopy( OLD_PATH, NEW_PATH, CALLBACK );
```

The `hashCopy()` method copies a hash and all of its items to a new path.  Specify the existing hash path, a new path, and a callback.  If anything exists at the destination path, it will be clobbered.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.hashCopy( 'hash1', 'hash2', function(err) {
	if (err) throw err;
} );
```

If a hash already exists at the destination path, you should delete it first.  It will be overwritten, but if the new hash has different pages, some of the old hash pages may still exist and occupy space, detached from their old parent hash.  So it is always safest to delete first.

## hashRename

```javascript
storage.hashRename( OLD_PATH, NEW_PATH, CALLBACK );
```

The `hashRename()` method renames (moves) a hash and all of its items to a new path.  Specify the existing hash path, a new path, and a callback.  If anything exists at the destination path, it will be clobbered.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.hashRename( 'hash1', 'hash2', function(err) {
	if (err) throw err;
} );
```

If a hash already exists at the destination path, you should delete it first.  It will be overwritten, but if the new hash has different pages, some of the old hash pages may still exist and occupy space, detached from their old parent hash.  So it is always safest to delete first.

## hashDelete

```javascript
storage.hashDelete( PATH, KEY, [ENTIRE], CALLBACK );
```

The `hashDelete()` method deletes a single key/value pair from the specified hash.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.hashDelete( 'users', 'dtrump', function(err) {
	if (err) throw err;
} );
```

By default, if `hashDelete()` removes the last key from a hash, it leaves an "empty" hash in storage (i.e. one with a header, page size, options, etc.).  However, if you would prefer, you can trigger a full delete if the hash becomes empty after the key is removed.  To do this, pass `true` as the 3rd argument, just before your callback.  Example:

```javascript
storage.hashDelete( 'users', 'dtrump', true, function(err) {
	if (err) throw err;
} );
```

## hashDeleteMulti

```javascript
storage.hashDeleteMulti( PATH, KEYS, CALLBACK );
```

The `hashDeleteMulti()` method deletes multiple hash records at once, from a specified array of keys.  Depending on your storage [concurrency](../README.md#concurrency) configuration, this may be significantly faster than deleting the records in sequence.  Example:

```javascript
storage.hashDeleteMulti( 'users', ['bsanders', 'hclinton', 'dtrump'], function(err) {
	if (err) throw err;
} );
```

## hashDeleteAll

```javascript
storage.hashDeleteAll( PATH, [ENTIRE], CALLBACK );
```

The `hashDeleteAll()` method deletes a hash and all its contents.  If you pass `true` for the second argument, the *entire* hash will be deleted, including the header (options, page size, etc.).  Otherwise the hash will simply be "cleared" (all items deleted) but the hash header will remain.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  Example:

```javascript
storage.hashDeleteAll( 'users', true, function(err) {
	if (err) throw err;
} );
```

## hashGetInfo

```javascript
storage.hashGetInfo( PATH, CALLBACK );
```

The `hashGetInfo()` method retrieves information about the hash, without loading any items.  Specifically, it fetches the hash length, page size, and any custom properties you passed to the `OPTIONS` object when first creating the list.  Your callback function is passed an error if one occurred, otherwise it'll be falsey.  The second argument will be the hash info object, if successful.  Example:

```javascript
storage.hashGetInfo( 'users', function(err, info) {
	if (err) throw err;
	console.log( "The hash has " + info.length + " keys." );
} );
```

Here are the keys you can expect to see in the info object:

| Key | Description |
|-----|-------------|
| `type` | Type of record, will be `hash`. |
| `length` | Total number of records in the hash. |
| `page_size` | Maximum number of hash items per page. |

# Transaction Methods

## begin

```js
storage.begin( PATH, CALLBACK );
```

The `begin()` method starts a new transaction.  This asynchronous method passes a special storage proxy object to your callback, which presents a "branch" or "view" of the database.  It is a proxy object upon which you can call any standard storage API methods, e.g. [put()](#put), [get()](#get), [delete()](#delete) or other.  Any operations on the transaction object take place in complete isolation, separate from the main storage object.  Example:

```js
storage.begin( 'some_path', function(err, trans) {
	
	// perform actions using `trans` proxy
	// e.g. trans.put(), trans.get(), trans.delete()
	
	// commit transaction here (see below)
});
```

## commit

```js
trans.commit( CALLBACK );
```

The `commit()` method completes the transaction, applies all the changes to main storage, and releases the lock.  At that point you should discard the `trans` object, as it can no longer be used.  This method should be called on your transaction proxy object obtained by calling [begin()](#begin).  Example use:

```js
storage.begin( 'some_path', function(err, trans) {
	
	// perform actions using `trans` proxy
	// e.g. trans.put(), trans.get(), trans.delete()
	
	// commit transaction
	trans.commit( function(err) {
		// complete
	} );
});
```

You can omit the callback to `commit()` if you know your transaction has zero write operations.  In this case it should release the lock and discard the transaction in the same thread.  However, use this with care.

## abort

```js
trans.abort( CALLBACK );
```

The `abort()` method cancels a transaction in progress, and rolls everything back (if any changes occurred).  This also releases the transaction lock and renders the transaction object dead.  This method should be called on your transaction proxy object obtained by calling [begin()](#begin).  Example use:

```js
storage.begin( 'some_path', function(err, trans) {
	
	// perform actions using `trans` proxy
	// e.g. trans.put(), trans.get(), trans.delete()
	
	// commit transaction
	trans.commit( function(err) {
		// check for error
		if (err) {
			// error during commit, abort it and roll back
			return trans.abort( function() {
				// rollback complete
			} );
		}
		
		// transaction is complete
	} );
});
```

You can call `abort()` anytime before or after calling [commit()](#commit), to manually abort the transaction yourself.  However, it should be noted that if you receive an error from a [commit()](#commit) call, it is *vital* that you call `abort()` to undo whatever operations may have already executed.  A commit error is typically very bad, and your storage system will be in an unknown state.  Only by calling `abort()` can you restore it to before the transaction started.

If the abort also fails, then the database raises a fatal error and exits immediately.  See [Emergency Shutdown](Transactions.md#emergency-shutdown) for details about what this means, and [Recovery](Transactions.md#recovery) for how to get back up and running.  Examples of fatal errors include your disk running completely out of space, or a major network failure when using NFS, S3 or Couchbase.

# Indexer Methods

## indexRecord

```
storage.indexRecord( ID, RECORD, CONFIG, [CALLBACK] );
```

The `indexRecord()` method submits a data record to the [Indexer](Indexer.md) system, and associates it with a unique ID.  Based on a [configuration](Indexer.md#configuration) object you provide, one or more fields will be indexed by value.  Your record can then be [searched](Indexer.md#searching-records) using custom queries.  The method takes three arguments, plus an optional callback:

- A unique ID for the record (string).
- An object containing the record to be indexed.
- A configuration object describing all the fields and sorters to apply.
- An optional callback.

Example:

```js
storage.indexRecord( "TICKET0001", record, config, function(err) {
	// record is fully indexed
	if (err) throw err;
} );
```

For more details and a complete example, see the [Indexing Records](Indexer.md#indexing-records) section.

## unindexRecord

```
storage.unindexRecord( RECORD_ID, CONFIG, [CALLBACK] );
```

The `unindexRecord()` method removes a data record from the [Indexer](Indexer.md) system.  You *do not* need to include the data record itself for unindexing.  The method takes two arguments, plus an optional callback:

- A unique ID for the record (string).
- A configuration object describing all the fields and sorters.
- An optional callback.

Example:

```js
storage.unindexRecord( "TICKET0001", config, function(err) {
	// record is completely removed from the index
	if (err) throw err;
} );
```

For more details and a complete example, see the [Unindexing Records](Indexer.md#unindexing-records) section.

## searchRecords

```
storage.searchRecords( QUERY, CONFIG, CALLBACK );
```

The `searchRecords()` method performs an index search.  Pass in a search query, your [index configuration](Indexer.md#configuration) object, and a callback.  Your callback will be passed an Error object (or false on success), and a hash of all the matched record IDs.  Here is an example:

```js
storage.searchRecords( 'modified:2018/01/07 tags:bug', config, function(err, results) {
	// search complete
	if (err) throw err;
	
	// results will be hash of record IDs
	// { "TICKET0001": 1, "TICKET0002": 1 }
} );
```

This finds all records that were modified on Jan 7, 2018 **and** contain the tag `bug`.  This syntax is called a [simple query](Indexer.md#simple-queries), and is explained in detail below, along with the more complex [PxQL](Indexer.md#pxql-queries) syntax.

For more details on searching records, see the [Searching Records](Indexer.md#searching-records) section.

## sortRecords

```
storage.sortRecords( RESULTS, SORTER, DIRECTION, CONFIG, CALLBACK );
```

The `sortRecords()` method performs a sort operation on search results, as returned from [searchRecords()](#searchrecords).  The method accepts the following 5 arguments:

- An unsorted hash of record IDs, as returned from [searchRecords()](#searchrecords).
- The ID of the sorter field, e.g. `username`, `num_comments`.
- The sort direction, which should be `1` for ascending, or `-1` for descending (defaults to `1`).
- Your main index [configuration](Indexer.md#configuration) object, containing the `sorter` array.
- A callback to receive the final sorted IDs.

Here is an example sort:

```js
// sort the results by username ascending
storage.sortRecords( results, 'username', 1, config, function(err, sorted) {
	// sort complete
	if (err) throw err;
	
	// sorted IDs will be in array
	// [ "TICKET0001", "TICKET0002", "TICKET0003" ]
} ); // sortRecords
```

Once you have an array of your sorted record IDs, you can then implement your own pagination system (i.e. limit & offset), and load multiple records at at time via [getMulti()](#getmulti) or other.

For more details on sorting search results, see the [Sorting Results](Indexer.md#sorting-results) section.

## getFieldSummary

```
storage.getFieldSummary( FIELD_ID, CONFIG, CALLBACK );
```

The `getFieldSummary()` method fetches a summary of all word counts for an index field.  This requires a field indexed with the [master list](Indexer.md#master-list) feature enabled.  Then you can fetch a "summary" of the data values, which returns a hash containing all the unique words from the index, and their total counts (occurrences) in the data.  Example use:

```js
storage.getFieldSummary( 'status', config, function(err, values) {
	if (err) throw err;
	
	// values should contain a hash with word counts:
	// { "open": 45, "closed": 13, "assigned": 3 }
} );
```

Summaries work best for fields that contain a relatively small amount of unique words, such as a "status" field.

## searchSingle

```
storage.searchSingle( QUERY, RECORD_ID, CONFIG, CALLBACK );
```

The `searchSingle()` method performs a search on a *single* record, simply indicating if it matches the search criteria or not.  Pass in any [search query](Indexer.md#searching-records), the ID of the record you want to check, your [index configuration](Indexer.md#configuration) object, and a callback.  Your callback will be passed an Error object (or false on success), and a Boolean indicating if the specified record would be included in the search results, or not.  Here is an example:

```js
storage.searchSingle( 'modified:2018/01/07 tags:bug', "TICKET0001", config, function(err, result) {
	// search complete
	if (err) throw err;
	
	// result will be true in this case
} );
```

This is an internal method designed for "testing" searches against a single record.  One possible use is a "live search" system, which would test each changed record against a query, and then making individual changes to a live result set, and publishing those changes to subscribers.
