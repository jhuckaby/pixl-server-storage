# Hashes

A hash is a collection of JSON records, indexed by key, that can grow to virtually any size without using much memory.  The collection is split into one or more "pages" and each page holds up to N records (configurable).  When the hash grows beyond the page size, it is automatically re-indexed into nested pages.  The hash store and fetch operations are very fast, and hashes can also be iterated over (keys are retrieved in undefined order).

The benefit of using a hash over simply calling [get()](API.md#get) and [put()](API.md#put) is that a hash can be iterated over, the key count can be retrieved at any time, and repeated operations are accelerated due to the nature of the paging system.  Also, hash keys are not [normalized](../README.md#key-normalization) like storage paths are, so you could have full Unicode / Emoji hash keys if you wanted.

All hash operations will automatically lock the hash using [Advisory Locking](../README.md#advisory-locking) (shared locks or exclusive locks, depending on if the operation is read or write), and unlock it when complete.  This is because all hash operations involve multiple concurrent low-level storage calls.  Hashes can be used inside [Transactions](Transactions.md) as well.

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)

<!-- toc -->
- [Hash Page Size](#hash-page-size)
- [Creating Hashes](#creating-hashes)
- [Storing and Fetching](#storing-and-fetching)
- [Iterating Over Hashes](#iterating-over-hashes)
- [Copying and Renaming](#copying-and-renaming)
- [Deleting](#deleting)
- [Hash Internals](#hash-internals)

## Hash Page Size

Hash items are stored in groups called "pages", and each page can hold up to N items (the default is 50).  When the number of hash keys exceeds the page size, the hash is re-indexed into sub-pages.  This all happens automatically behind the scenes, but care should be taken to choose your optimal page size.  In general, the larger your hash records, the smaller the page size should be.

You can configure how many items are allowed in each page, by changing the default [page size](../README.md#hash_page_size) in your storage configuration, or setting it per hash by passing an option to [hashCreate()](API.md#hashcreate).

Care should be taken when calculating your hash page sizes.  It all depends on how large your items will be, and if you will be iterating over them often.  Note that you cannot easily change the page size on a populated hash (this may be added as a future feature).

## Creating Hashes

To create a hash, call [hashCreate()](API.md#hashcreate).  Specify the desired storage path, options, and a callback function.  You can optionally pass in a custom page size via the second argument (otherwise it'll use the default size):

```javascript
storage.hashCreate( 'hash1', { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

You can also store your own properties in the options object, which are retrievable via the [hashGetInfo()](API.md#hashgetinfo) method.  However, beware of name collision -- better to prefix your own option props with something unique.

## Storing and Fetching

Hashes have basic methods for storing and fetching keys, as you might expect.  When accessing hashes, you generally need to specify two different strings: A single base "storage path" (where the hash lives in storage), and then each record inside the hash also has its own key.

To store a key/value pair, call [hashPut](API.md#hashput), and to fetch a value based on its key, call [hashGet()](API.md#hashget).  If a key already exists, `hashPut()` will replace it.  If you try to fetch a nonexistent key via `hashGet()`, an Error object will be passed to your callback with its `code` property set to `NoSuchKey`.

Here is an example of storing and fetching a hash record.  The hash itself is located at the storage path `users`, and we are storing and fetching the hash key `bsanders` within that hash.

```javascript
// Store a key/value pair
storage.hashPut( 'users', 'bsanders', { name: 'Bernie', age: 75 }, function(err) {
	if (err) throw err;
	
	// Fetch a value given its key
	storage.hashGet( 'users', 'bsanders', function(err, value) {
		if (err) throw err;
		
		console.log( value );
		// { name: 'Bernie', age: 75 }
	} );
} );
```

Note that you do not need to explicitly create the hash via [hashCreate()](API.md#hashcreate).  The [hashPut](API.md#hashput) method will auto-create it for you if necessary.

In addition to storing single records, you can specify multiple at a time using the [hashPutMulti()](API.md#hashputmulti) method.  Instead of key and value arguments, pass in an object containing as many as you want:

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

Similarly, to fetch multiple records, use [hashGetMulti()](API.md#hashgetmulti).  Specify your desired keys in an array, and you'll get an array of values with numerical indexes that match up to your keys:

```javascript
storage.hashGetMulti( 'users', ['bsanders', 'hclinton', 'dtrump'], function(err, values) {
	if (err) throw err;
	// values[0] will be the bsanders record.
	// values[1] will be the hclinton record.
	// values[2] will be the dtrump record.
} );
```

Finally, if you simply want to fetch *all* the records in a hash in one fell swoop, and you aren't concerned with memory usage, call [hashGetAll()](API.md#hashgetall).

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

## Iterating Over Hashes

For iterating over a hash, you have two options.  First, you can use [hashEach()](API.md#hasheach), which fires an asynchronous iterator for every key/value pair.  The iterator is passed the current key, value, and a callback which must be fired (similar to [async eachSeries()](http://caolan.github.io/async/docs.html#.eachSeries)).  Pass an error to the callback to abort the loop in the middle.  Example:

```js
storage.hashEach( 'users', function(key, value, callback) {
	// do something with key/value
	callback();
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

Alternatively, you can use [hashEachSync()](API.md#hasheachsync) in which the iterator is invoked in a *synchronous* manner, i.e. continuing as soon as it returns (similar to [Array.forEach()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach)).  However, please note that the full loop operation isn't synchronous, and you need to provide a callback to be fired when every key has been iterated over.  Example:

```javascript
storage.hashEachSync( 'users', function(key, value) {
	// do something with key/value
	// no callback here
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

Finally, you can use [hashEachPage()](API.md#hasheachpage), which iterates over the internal hash pages, and only fires your iterator function once per page, instead of once per key.  This is typically faster as it requires fewer function calls.  Your iterator is invoked in an *asynchronous* manner, i.e. it must fire a callback to continue (similar to [async eachSeries()](http://caolan.github.io/async/docs.html#.eachSeries)).  Example:

```javascript
storage.hashEachPage( 'users', function(items, callback) {
	// do something with page of items
	for (var key in items) {
		var value = items[key];
		// do something with each key/value pair
	}
	
	// fire callback to continue to next page
	callback();
}, 
function(err) {
	if (err) throw err;
	// all keys iterated over
} );
```

## Copying and Renaming

To duplicate a hash and all of its items at a new storage path, call [hashCopy()](API.md#hashcopy), specifying the old and new paths.  Example:

```javascript
storage.hashCopy( 'hash1', 'hash2', function(err) {
	if (err) throw err;
} );
```

To rename a hash, call [hashRename()](API.md#hashrename).  This is basically just a [hashCopy()](API.md#hashcopy) followed by a [hashDeleteAll()](API.md#hashdeleteall).  Example:

```javascript
storage.hashRename( 'hash1', 'hash2', function(err) {
	if (err) throw err;
} );
```

With both of these functions, it is highly recommended you make sure the destination (target) path is empty before copying or renaming onto it.  If a hash already exists at the destination path, it will be overwritten, but if the new hash has different content, some of the old hash pages may still exist and occupy space, detached from their old parent hash.  So it is always safest to delete first, or use a path you know to be vacant.

## Deleting

To delete a single hash key, call [hashDelete()](API.md#hashdelete).  Example:

```javascript
storage.hashDelete( 'users', 'dtrump', function(err) {
	if (err) throw err;
} );
```

If you delete the last key from a hash, an "empty" hash will remain in storage (this includes metadata such as the options, page size, etc).  If you want to delete the *entire* hash when the last key is removed, pass `true` as the 3rd argument before the callback:

```javascript
storage.hashDelete( 'users', 'dtrump', true, function(err) {
	if (err) throw err;
} );
```

To delete multiple hash keys at once, use [hashDeleteMulti()](API.md#hashdeletemulti).  Specify your desired keys in an array:

```javascript
storage.hashDeleteMulti( 'users', ['bsanders', 'hclinton', 'dtrump'], function(err) {
	if (err) throw err;
} );
```

Finally, to delete an *entire* hash including all its keys, call [hashDeleteAll()](API.md#hashdeleteall):

```javascript
storage.hashDeleteAll( 'users', function(err) {
	if (err) throw err;
} );
```

As with `hashDelete()`, by default this will only empty a hash, leaving behind an empty header record (with options, page size, etc).  To delete that as well, pass `true` as the 2nd argument before the callback:

```javascript
storage.hashDeleteAll( 'users', true, function(err) {
	if (err) throw err;
} );
```

## Hash Internals

Hashes are implemented on top of basic storage using a paging system.  Each hash has a main header record containing basic information such as the number of keys, and options such as page size.  Then, under that base path lives each page, containing up to [N](../README.md#hash_page_size) hash records.  When enough keys are added to the hash so that a page overflows, it is automatically "reindexed" into sub-pages.

A basic hash with fewer than [N](../README.md#hash_page_size) keys looks like this on a [raw filesystem](../README.md#raw-file-paths):

```
data/
 ├ users/
 │  └ data.json
 └ users.json
```

In this example we have a simple users hash with 3 keys.  Storage key `users` (file: `users.json`) is the main header record containing metadata about the hash:

```js
{
	"page_size": 10,
	"length": 3,
	"type": "hash"
}
```

Here are descriptions of the header properties:

| Property | Description |
|----------|-------------|
| `type` | A static identifier, which will always be set to `hash` for the header record. |
| `length` | How many items are currently in the hash. |
| `page_size` | How many items are stored per page. |

The actual hash keys and values are stored in a sub-record, in this case `users/data` (file: `users/data.json`).  The format of this file is very simple:

```js
{
	"type": "hash_page",
	"length": 3,
	"items": {
		"bsanders": {
			"name": "Bernie",
			"age": 75
		},
		"hclinton": {
			"name": "Hillary",
			"age": 68
		},
		"dtrump": {
			"name": "Donald",
			"age": 70
		}
	}
}
```

This is a hash page, and represents one chunk of the hash, containing up to [N](../README.md#hash_page_size) keys.  It has a `type` property set to `hash_page`, its own `length` which holds the number of keys in the page, and the keys/values are all stored in `items`.

Now let's see what happens to the raw filesystem when we store more than one page of records.  Here is what it looks like after adding the 11th record (with a [hash_page_size](../README.md#hash_page_size) of 10):

```
data/
 ├ users/
 │  ├ data/
 │  │  ├ 0.json
 │  │  ├ 1.json
 │  │  ├ 3.json
 │  │  ├ 5.json
 │  │  ├ 6.json
 │  │  ├ 8.json
 │  │  ├ 9.json
 │  │  ├ c.json
 │  │  └ e.json
 │  └ data.json
 └ users.json
```

As you can see, the `users.json` and `users/data.json` files are still present.  The only difference in the main header file (`users.json`) is the `length` property, which is now `11`:

```js
{
	"page_size": 10,
	"length": 11,
	"type": "hash"
}
```

But look at what happened to `users/data.json`:

```js
{
	"type": "hash_index"
}
```

This record previously contained all the hash keys and values, so where did they all go?  Well, as you can see the `type` property was changed from `hash_page` to `hash_index` here.  This is a hint that the hash was re-indexed, and all the actual content is now located deeper.  Basically, there are too many records to stuff into one page, so they are now spread out amongst several:

```
users/data/0.json
users/data/1.json
users/data/3.json
users/data/5.json
users/data/6.json
users/data/8.json
users/data/9.json
users/data/c.json
users/data/e.json
```

Let's look at one of them, say `users/data/3.json`:

```js
{
	"type": "hash_page",
	"length": 2,
	"items": {
		"bsanders": {
			"name": "Bernie",
			"age": 75
		},
		"ecummings": {
			"name": "Eric",
			"age": 54
		}
	}
}
```

As you can see, this is where the `hash_page` records went, and in this case it contains two of our eleven items.  But why only these two, and why is it named `3.json`?  The answer is that the hash keys are run through the [MD5](https://en.wikipedia.org/wiki/MD5) algorithm, and the first character of the resultant MD5 digest (in hexadecimal format) is used to distribute the keys amongst sub-pages.

That's also why we are seemingly missing `2.json`, `7.json` and others.  The reason is, with only 11 keys total, only some hexadecimal characters are in use.  To illustrate, here are the 11 sample keys we used, and their MD5 digests:

| Hash Key | MD5 Digest |
|----------|------------|
| `bsanders` | `328cb5dbe722f89a329f8682a4de15d7` *(Starts with digit 3)* |
| `hclinton` | `ebdc9e6342a5adbc59781dfae3fca9fb` |
| `dtrump` | `107b9e22a331462e6c7431e3cc26e367` |
| `asmith` | `959074c6444c990db64c44e363b28b10` |
| `bhenry` | `05aadeb041feb91a515d1611a5a74210` |
| `crooster` | `e1132752dcaafcda8638a3ec37e4dee2` |
| `darment` | `547ba8d76f4e71ff3c0fe8b0389c9386` |
| `ecummings` | `3951e70aa4c883c97769f47929a4b88b` *(Starts with digit 3)* |
| `fhollister` | `cb53189cb9fabcc791e78e4a52e3a189` |
| `gsangrias` | `85ce076e883b53de15909cd9e6bd1346` |
| `hpostit` | `61aa3183de742f5361d6e83e110f8616` |

As you can see, the `bsanders` and `ecummings` keys both have MD5 digests that begin with `3`.  That's why they both share the `users/data/3.json` hash page.

The hash re-index system goes even deeper.  As soon as these sub-pages fill up and individually contain more than [hash_page_size](../README.md#hash_page_size) records, *another* re-index event occurs, on the specific page, and sends values even deeper down the index hole.  But in subsequent re-indexes, different MD5 digest characters are used.

For example, with two levels of indexing, the `bsanders` record would be relocated to this page:

```
data/users/data/3/2.json
```

This now uses the first 2 characters of the key's MD5 digest, in hexadecimal format.

And the previous `users/data/3.json` page is converted to a `hash_index` record (just like what happened with `users/data.json` on the first-level re-index):

```js
{
	"type": "hash_index"
}
```

This re-indexing process can continue virtually indefinitely, theoretically up to the full 32 hex characters of the MD5 digest.  There is effectively no limit to the number of keys (well, 2^128 keys max), but things definitely slow down in the millions, and filesystems run out of [inodes](https://en.wikipedia.org/wiki/Inode) at a certain point.

If keys are deleted from a hash, an "un-index" event may also occur, which is literally the reverse of a re-index.  The affected sub-pages are all deleted, and the remaining hash records, if any, are gathered together in a parent level.

Note that all re-index and un-index operations are automatic and happen in the background, so your code doesn't have to worry.  Locking is always used, so there is no chance of data corruption.
