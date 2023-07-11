# Indexer

The indexer subsystem provides a way to "index" your JSON records by one or more fields, and then perform searches using a simple query language.  It is essentially a word indexer at its core, built on top of the standard storage APIs, but provides full text search capabilities, as well as unique keywords, numbers and dates.

Before using the indexer, please keep the following in mind:

- This is not a full database by any stretch -- merely a simplistic and rudimentary way to index and search records.
- All your records must have a unique ID string.
	- This will be the primary index, and the key you get back from searches.
- You are expected to store your record data yourself.
	- The indexer **only** indexes fields for searching purposes -- it does not store raw records for retrieval.
- When performing a search, you **only** get your record IDs back.  
	- You are expected to paginate and fetch your own record data (i.e. via [getMulti()](API.md#getMulti) or other).

The indexer works with any storage engine, but it is optimized for the local filesystem.  Transactions are automatically used for indexing and unindexing records, if they are enabled (this is highly recommended).

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)

<!-- toc -->
- [Caveats](#caveats)
- [Configuration](#configuration)
	* [Standard Indexes](#standard-indexes)
		+ [Master List](#master-list)
	* [Full Text Indexes](#full-text-indexes)
		+ [Text Filters](#text-filters)
		+ [Remove Words](#remove-words)
	* [Custom Field Types](#custom-field-types)
		+ [Number Type](#number-type)
		+ [Date Type](#date-type)
- [Indexing Records](#indexing-records)
	* [Source Paths](#source-paths)
	* [Text Cleanup](#text-cleanup)
	* [Boolean Values](#boolean-values)
	* [Null Values](#null-values)
	* [Default Values](#default-values)
	* [Unicode Characters](#unicode-characters)
	* [Stemming](#stemming)
- [Unindexing Records](#unindexing-records)
- [Searching Records](#searching-records)
	* [Simple Queries](#simple-queries)
	* [PxQL Queries](#pxql-queries)
	* [Fetching All Records](#fetching-all-records)
- [Sorting Results](#sorting-results)
- [Field Summaries](#field-summaries)
- [Bulk Reindexing](#bulk-reindexing)
	* [Adding Fields](#adding-fields)
	* [Deleting Fields](#deleting-fields)
	* [Changing Fields](#changing-fields)
- [Performance Tips](#performance-tips)
- [Indexer Internals](#indexer-internals)
	* [Date and Number Fields](#date-and-number-fields)
	* [Special Metadata](#special-metadata)

## Caveats

The indexer only processes words that contain standard U.S. ASCII alphanumeric characters, e.g. A-Z, 0-9, and underscore.  All other characters are skipped, and serve as word separators.  International (Unicode) characters are converted to ASCII at index and search time (see [Unicode Characters](#unicode-characters) below for more on this).

The indexer is **very slow**.  All index operations involve reading and writing JSON storage records *at the word level* (i.e. a hash for each unique word!), and the system is designed to eat as little memory as possible.  Expect hundreds or even thousands of storage operations for indexing a single record.  Searching is fairly quick by comparison, because typically you're only searching on a small number of words.  This also assumes your storage back-end is fast (preferably local SSD filesystem), and your search queries are simple and straightforward.

This system is not designed for large datasets.  Thousands of records is probably fine, and maybe even tens of thousands depending on the index types and data size.  *Hundreds of thousands* of records would likely end in tears.  Also, keep an eye on your [inodes](https://en.wikipedia.org/wiki/Inode), because this thing is hungry for them.

Remember, this is just a silly hobby project.  You should not use this for any production applications.

## Configuration

To use the indexer, you need to provide a configuration object which describes how to index and sort your records.  This object must be stored externally by your application, and passed into all calls to [indexRecord()](API.md#indexrecord), [unindexRecord()](API.md#unindexrecord) and [sortRecords()](API.md#sortrecords).  Here is the general configuration layout:

```js
{
	"base_path": "index/myapp",
	"fields": [
		...
	],
	"sorters": [
		...
	],
	"remove_words": [
		...
	]
}
```

The `base_path` property tells the indexer where to store its records in main storage.  This can be any unique path, and it doesn't need to exist.  The indexer records will use this as a prefix.  Note that you should not store any of your own records under this path, to avoid potential collisions.  The base path is also used for transaction locking.

The `fields` array should contain an object for each field in your data you want indexed.  Here is an example field index definition:

```js
"fields": [
	{
		"id": "status",
		"source": "/TicketStatus"
	}
]
```

This would create a simple word field index with ID `status` (must be alphanumeric) and a source path of `/TicketStatus`.  The `source` should be a "virtual path" of where to locate the text value inside your record data.  See [Source Paths](#source-paths) below for more details.

For a full text search field (i.e. multi-word paragraph text), more properties are recommended:

```js
"fields": [
	{
		"id": "body",
		"source": "/BodyText",
		"min_word_length": 3,
		"max_word_length": 64,
		"use_remove_words": true,
		"use_stemmer": true,
		"filter": "html"
	}
]
```

This example would create a full text index with ID `body` and a source path of `/BodyText`.  It would only index words that are between 3 and 64 characters in length, use a [remove word](#remove-words) list, use [stemming](#stemming) for normalization, and apply a [HTML pre-filter](#text-filters).  See [Full Text Indexes](#full-text-indexes) for more on these types of fields.

Here is the full list of available properties for each index definition:

| Property Name | Type | Description |
|---------------|------|-------------|
| `id` | String | A unique alphanumeric ID for the field. |
| `type` | String | Optional custom field type (see [Custom Field Types](#custom-field-types) below). |
| `source` | String | A virtual path specifying the location of the text value inside your record data (see [Source Paths](#source-paths)). |
| `min_word_length` | Number | Optionally set a minimum word length (shorter words are skipped).  Highly recommended for [Full Text Indexes](#full-text-indexes).  Defaults to `1`. |
| `max_word_length` | Number | Optionally set a maximum word length (longer words are skipped).  Highly recommended for [Full Text Indexes](#full-text-indexes).  Defaults to `255`. |
| `max_words` | Number | Optionally set a maximum number of words to index per record.  If the source has additional words beyond the max they will be ignored. |
| `use_remove_words` | Boolean | Optionally use a remove word list for common words.  Highly recommended for [Full Text Indexes](#full-text-indexes).  See [Remove Words](#remove-words).  Defaults to `false` (disabled). |
| `use_stemmer` | Boolean | Optionally use a stemmer to normalize words.  Highly recommended for [Full Text Indexes](#full-text-indexes).  See [Stemming](#stemming).  Defaults to `false` (disabled). |
| `filter` | String | Optionally filter text with specified method before indexing.  See [Text Filters](#text-filters).  Defaults to disabled. |
| `master_list` | Boolean | Optionally keep a list of all unique words for the index.  See [Master List](#master-list).  Defaults to `false` (disabled). |
| `default_value` | String | Optional default value, for when record has no value for the field, or it is set to `null`.  See [Default Values](#default-values). |
| `no_cleanup` | Boolean | *(Advanced)* Set this to `true` to skip all text cleanup, and index it raw instead.  See [Text Cleanup](#text-cleanup).  Only use this if you know what you are doing. |
| `delete` | Boolean | *(Advanced)* Set this to `true` to force the indexer to delete the data for the field.  See [Deleting Fields](#deleting-fields) below.

The `sorters` array allows you to specify which fields you will need to sort by.  These fields do not need to be indexed -- they can be "sort only" fields.  Each needs an `id` and a `source` (data path, same as with fields).  Example:

```js
"sorters": [
	{
		"id": "created",
		"source": "/CreateDate",
		"type": "number"
	}
]
```

If you specify a `type` property and set it to `number`, then the values will be sorted numerically.  The default sort type is alphabetically.  In the above example the `CreateDate` property is assumed to be Epoch seconds (i.e. a sortable number).  See [Sorting Results](#sorting-results) below for more details.

The `remove_words` array allows you to specify a custom list of "remove words".  These words are removed (skipped) from indexing, if the definition sets the `use_remove_words` property.  Example:

```js
"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
```

The idea here is that you only need to specify one global remove word list, and multiple fields can all share it.  See [Remove Words](#remove-words) below for more on this.

### Standard Indexes

A "standard" word index is one that simply doesn't have all the full text options enabled.  So instead of trying to clean, normalize, stem, filter and remove words for paragraph text, this instead indexes the *exact* word values provided.  It is designed to index one (or multiple) plain words, such as a "status", "flags" or "tags" database column.  Example:

```js
"fields": [
	{
		"id": "status",
		"source": "/TicketStatus"
	}
]
```

If you were designing a change control ticketing system, for example, then the `TicketStatus` property in your record data may contain something like `Open`, `Closed`, `Complete`, or `Canceled`.  This is a good candidate for a standard word index.

Multiple words will work fine as well.  Each word is indexed separately, so you can perform complex searches using one or more.  Just separate your words with any non-word character (comma, space, etc.).

#### Master List

If you want to be able to fetch all the unique words in an index, as well as their counts (number of records per word) you can use a "master list".  This feature is enabled by adding a `master_list` property to the definition, and setting it to `true`.  Example:

```js
"fields": [
	{
		"id": "status",
		"source": "/Status",
		"master_list": true
	}
]
```

Please note that this adds an extra storage operation per index per record, so do keep performance in mind.  This is only recommended for fields that have a relatively small amount of unique words, such as a "status" field.  This should **not** be used for full text search fields.  See [Field Summaries](#field-summaries) below for instructions on how to fetch the data.

### Full Text Indexes

A "full text" index is one that is designed to process multi-line or paragraph text.  Technically there is nothing you need to do to enable this, as all fields are word indexes, but there are several additional properties which are highly recommended if your source text is longer than a few single words.  Example:

```js
"fields": [
	{
		"id": "body",
		"source": "/BodyText",
		"min_word_length": 3,
		"max_word_length": 64,
		"max_words": 512,
		"use_remove_words": true,
		"use_stemmer": true,
		"filter": "html"
	}
]
```

All of these additional properties are designed to help the indexer be more efficient, skip over or otherwise reduce insignificant words.  They are all recommended settings, but you can customize them to your app's specific needs.

Setting a `min_word_length` will skip words that are under the specified number of characters, in this case all single and double character words (which are usually insignificant for searches).  Similarly, the `max_word_length` causes the indexer to skip any words over the specified length, in this case 64 characters (longer words probably won't be searched for).  Note that the same rules apply to search queries as well, so searches that contain skipped words along with real words will still work correctly.

The `max_words` property sets a maximum upper limit of words to be indexed per record for this field.  If the source input text exceeds this limit, the extra words are simply ignored by the indexer.

Setting `use_remove_words` allows the indexer to skip over common words that are typically insignificant for searches, like `the`, `of`, `and`, `that`, and so on.  The same words are removed from search queries, allowing them to work seamlessly.  See [Remove Words](#remove-words) below for more on this.

Setting `use_stemmer` instructs the indexer to reduce words to their common "[stems](https://en.wikipedia.org/wiki/Stemming)".  For example, `jumping` and `jumps` would both be reduced to `jump`.  Search queries get stemmed in the same way, so you can still search for `jumping` (or any variation) and find applicable records.  See [Stemming](#stemming) below for more on this.

#### Text Filters

Text filters provide a way to cleanup specific markup languages, leaving only searchable words in the text.  They are specified by including a `filter` property in your index definition, and setting it to one of the following strings:

| Filter | Description |
|--------|-------------|
| `html` | This filter strips all HTML tags, and decodes all HTML entities prior to indexing.  This also works for XML source. |
| `markdown` | This filter is designed for [Markdown](https://en.wikipedia.org/wiki/Markdown) source text.  It filters out [fenced code blocks](https://help.github.com/articles/creating-and-highlighting-code-blocks/) and also applies the `html` filter as well (you can embed HTML in markdown). |
| `alphanum` | This filter strips everything except for alphanumerics and underscores.  It's designed to reduce a string to a single indexable value. |

Note that URLs are always shortened so that only the hostname is indexed.  Full URLs are notoriously difficult (and rather useless) to index for searching.  See [Text Cleanup](#text-cleanup) below for details.

#### Remove Words

The remove word system allows you to specify a set of words to skip over when indexing.  This can be useful for things like common English words that have no real "search significance", like `the`, `it`, `them`, `that` and so on.  The words are removed from both indexing and search queries, so your users don't have to remember to omit certain words when searching.

For example, here are the 100 most common English words (sourced from this [top 1000 list](http://www.bckelk.ukfsn.org/words/uk1000n.html)), which are generally good candidates for removal:

```js
"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they", "I", "at", "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", "there", "use", "an", "each", "which", "she", "do", "how", "their", "if", "will", "up", "other", "about", "out", "many", "then", "them", "these", "so", "some", "her", "would", "make", "like", "him", "into", "time", "has", "look", "two", "more", "write", "go", "see", "number", "no", "way", "could", "people", "my", "than", "first", "water", "been", "call", "who", "oil", "its", "now", "find", "long", "down", "day", "did", "get", "come", "made", "may", "part"]
```

After defining the `remove_words` array once in the outer configuration object, your individual index definitions must specify that they want to use it.  This is done by setting a `use_remove_words` Boolean property in your full text fields.  Example:

```js
"fields": [
	{
		"id": "body",
		"source": "/BodyText",
		"use_remove_words": true
	}
]
```

### Custom Field Types

In addition to word indexing, you can also index numbers and dates.  These features are enabled by adding a `type` property to your index field definition, and setting it to either `number` or `date`.  Example:

```js
"fields": [
	{
		"id": "modified",
		"source": "/ModifyDate",
		"type": "date"
	}
]
```

#### Number Type

The number field type is enabled by setting the `type` property to `number`.  It is designed for "small integers" only.  Example:

```js
"fields": [
	{
		"id": "num_comments",
		"source": "/Comments/length",
		"type": "number"
	}
]
```

The number type is limited to integers, from -1,000,000 to 1,000,000.  Anything outside this range is clamped, and floating point decimals are rounded down to the nearest integer.

See [Searching Records](#searching-records) below for how to search on numbers and number ranges.

#### Date Type

The date field type is used to index dates.  The source input value can be any date format that Node.js supports, however the native word format is `YYYY_MM_DD`.  Example:

```js
"fields": [
	{
		"id": "modified",
		"source": "/ModifyDate",
		"type": "date"
	}
]
```

The date type is limited to dates only (i.e. time of day is not currently supported).  Also, if you specify any other input format besides `YYYY_MM_DD` then your source text is converted to `YYYY_MM_DD` using the server's local timezone.  Please keep this in mind when designing your app.

See [Searching Records](#searching-records) below for how to search on dates and date ranges.

## Indexing Records

To index a record, call the [indexRecord()](API.md#indexrecord) method, and pass in the following three arguments, plus an optional callback:

- A string ID for the record
	- Can contain any characters you want, but it must be valid and unique when [normalized](../README.md#key-normalization) as a storage key.
- An object containing the record to be indexed.
	- This may contain extraneous data, which is fine.  All it requires is that the data to be indexed is located at the expected [source paths](#source-paths).
- A configuration object describing all the fields and sorters to apply.
	- See [Configuration](#configuration) above.
- An optional callback.
	- Fired when the record is fully indexed and ready to search.
	- Passed an Error object, or something false on success.

Here is a simple example:

```js
// Index configuration
var config = {
	"base_path": "index/myapp",
	"fields": [
		{
			"id": "body",
			"source": "/BodyText",
			"min_word_length": 3,
			"max_word_length": 64,
			"max_words": 512,
			"use_remove_words": true,
			"use_stemmer": true,
			"filter": "html"
		},
		{
			"id": "modified",
			"source": "/ModifyDate",
			"type": "date"
		},
		{
			"id": "tags",
			"source": "/Tags",
			"master_list": true
		}
	],
	"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
};

// Record object
var record = {
	"BodyText": "This is the body text of my ticket, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
	"ModifyDate": "2018/01/07",
	"Tags": "bug, assigned, open"
};

// Index it!
storage.indexRecord( "TICKET0001", record, config, function(err) {
	// record is fully indexed
	if (err) throw err;
} );
```

This example would index three fields in our `TICKET0001` record:

- The `BodyText` property would be indexed as a full text string, using an [HTML pre-filter](#text-filters), 3/64 word length limits, [remove words](#remove-words) and [stemming](#stemming).
- The `ModifyDate` property would be indexed as a [date field](#date-type).
- The `Tags` property would be indexed as a simple word index, with a [master list](#master-list).

If you are performing an update to an existing record, you can provide a "sparse" data object.  Meaning, you can omit fields, and only include data sources for the fields you want to update.

### Source Paths

Source paths specify where in your record data to locate each value to be indexed.  They are formatted like filesystem paths (i.e. slash delimited), but refer to properties inside your record data.  For example:

```js
"fields": [
	{
		"id": "modified",
		"source": "/ModifyDate",
		"type": "date"
	}
]
```

Here the `source` property is set to `/ModifyDate`, which means that the indexer will look for the value in a property named `ModifyDate` at the top level of your record date.  The idea here is that your values may be nested several levels deep, or may even be something like an array length.  Consider this index configuration:

```js
"fields": [
	{
		"id": "num_comments",
		"source": "/Comments/length",
		"type": "number"
	}
]
```

Assuming your record data contained an array named `Comments`, this would index the *length* of that array into this number column.

You can also provide multiple sources of data to be indexed into a single source path.  To do this, wrap each source path in square brackets, and separate them by whitespace.  For example, consider a "combined" index containing both the record's title and body text:

```js
"fields": [
	{
		"id": "main_text",
		"source": "[/Title] [/BodyText]",
		"min_word_length": 3,
		"max_word_length": 64,
		"max_words": 512,
		"use_remove_words": true,
		"use_stemmer": true,
		"filter": "html"
	}
]
```

This would index both the `Title` and `BodyText` record data properties as one combined index with ID `main_text`.  Of course, you could just combine your own data strings and pass them into the indexer as one single property.  The source path system is just a convenience, so you can potentially pass in your original, unmodified record data object, and "point" the indexer at the right sub-elements for indexing.

### Text Cleanup

By default, all text goes through some basic cleanup prior to indexing.  This is to ensure better indexing quality, and to improve performance by skipping low-quality words.  The following input transformations are applied:

- Unicode characters are down-converted to ASCII equivalents, or stripped off.
	- See [Unicode Characters](#unicode-characters) below for details.
- URLs are stripped down to their hostnames only.
	- Word indexers do a very poor job of indexing URLs, and few people actually search for them.
	- URLs cause quite a bit of indexer churn, because they create a bunch of small "words" that are of low search quality.
- Single quotes are stripped off.
	- This way pluralized words are indexed as single words, e.g. `Nancy's` would be indexed as `Nancys`.
	- [Stemming](#stemming) also takes care of this by reducing even further.
- Floating-point numbers are converted to "words".
	- Underscores are considered word characters, so `2.5` is indexed as a single word: `2_5`.
	- This also handles version numbers like `2.5.1` (indexed as: `2_5_1`).
	- Note that this only applies to loose numbers found in text fields.  [Number](#number-type) fields are different, and currently accept only integers.

If you don't want this standard cleanup to take place, you can set the special `no_cleanup` property on your index definition.  But please only do this if you know exactly what you are doing.

### Boolean Values

While there is no native support for booleans, they are indexed as "words".  So if you have a data property that is a boolean, its value will be converted to a literal string (`true` or `false`) and that word is indexed just as if it was a string.  You can then search on it using `true` and `false` strings.

### Null Values

The indexer does **not** support null, undefined or empty values.  Meaning, no indexing takes place for these values, and thus you cannot search for "nothing".  If your app needs to handle this case, you simply need to come up with your own unique "null word", and pass that when you specifically want nothing indexed.  Consider using a string like `_NULL_` (underscores are word characters, so they get indexed as part of the word).

If your index field has a [master list](#master-list) and you query for a [field summary](#field-summaries), you will get back a `_null_` key with a record count, along with all your "actual" words in the index.  You can then massage this key in your UI, and show something like "(None)" instead.

### Default Values

You can optionally specify a "default value" for your indexes and sorters.  This is done by including an `default_value` property.  Records that are either completely missing a field value, or have it explicitly set to `null`, will be indexed as the default value.  Example configuration:

```js
"fields": [
	{
		"id": "status",
		"source": "/Status",
		"master_list": true,
		"default_value": "_none_"
	}
]
```

This would index all record statuses as `_none_` if the data field was missing (`undefined`) or explicitly set to `null`.  Combined with the [Master List](#master-list) feature, this allows you to count all your records that don't have a value for the field.

### Unicode Characters

The indexer only processes words that contain standard U.S. ASCII alphanumeric characters, e.g. A-Z, 0-9, and underscore.  All other characters are skipped, and serve as word separators.  International (Unicode) characters are converted to ASCII at index and search time, using the [unidecode](https://www.npmjs.com/package/unidecode) module.  This allows us to index words with accents and other symbols like this:

| Original | Indexed As |
|----------|------------|
| Café | `cafe` |
| El Niño | `el`, `nino` |
| Doppelgänger | `doppelganger` |

This also allows us to index words in non-European languages, because the amazing [unidecode](https://www.npmjs.com/package/unidecode) down-converts them to English / ASCII equivalents for us.  Examples:

| Original | Indexed As |
|----------|------------|
| 木 | `mu` |
| ネコ | `neko` |
| してく | `siteku` |

Note that this isn't a translation service, but more of a "*pronounced in English as*".  From the docs:

> The representation is almost always an attempt at transliteration -- i.e., conveying, in Roman letters, the pronunciation expressed by the text in some other writing system.

However, it serves the purpose of converting foreign words to ASCII phonetic equivalents, which are probably suitable for indexing in most cases.  The same conversion takes place behind the scenes on search queries, so you can actually search for international words as well.  Note that many of these conversions result in 2-letter "words", so make sure you set your `min_word_length` appropriately.

### Stemming

[Word Stemming](https://en.wikipedia.org/wiki/Stemming) is the process of removing common morphological and inflectional endings from words in English.  Basically, it normalizes or reduces words to their "stems", which involves stripping off pluralization and other extraneous characters from the end.  This improves searching, and reduces the number of unique words that the indexer is required to handle.  Stemming should really only be enabled on full-text indexes with English source text.

To enable stemming, set the `use_stemmer` property to `true` in your field definition.  It is disabled by default.  Example index configuration:

```js
"fields": [
	{
		"id": "body",
		"source": "/BodyText",
		"min_word_length": 3,
		"max_word_length": 64,
		"use_remove_words": true,
		"use_stemmer": true,
		"filter": "html"
	}
]
```

Here are a few example words and their stems:

| Original | Stemmed |
|----------|---------|
| jump | jump |
| jumps | jump |
| jumping | jump |
| jumped | jump |
| argue | argu |
| argued | argu |
| arguing | argu |
| argues | argu |
| argus | argu |
| argument | argument |
| arguments | argument |
| argumentative | argument |

Notice that in some cases it doesn't even produce a proper English word for the stem, e.g. `argu`.  Don't worry, this is normal -- remember that search queries are also stemmed, so you can search for any form of `argue` and still find the right records.  For this feature we lean on the wonderful [porter-stemmer](https://github.com/jedp/porter-stemmer) module, which uses [Martin Porter's stemmer algorithm](https://tartarus.org/martin/PorterStemmer/).

## Unindexing Records

To "unindex" a record (i.e. remove all indexed data for it), call the [unindexRecord()](API.md#unindexrecord) method and pass in the following two arguments, plus an optional callback.  You *do not* need to include the data record itself for unindexing.

- A string ID for the record
	- Needs to point to a valid record that was previously indexed.
	- The ID can contain any characters you want, but it must be valid and unique when [normalized](../README.md#key-normalization) as a storage key.
- A configuration object describing all the fields and sorters that were applied.
	- See [Configuration](#configuration) above.
- An optional callback.
	- Fired when the record is fully removed from the index.
	- Passed an Error object, or something false on success.

This effectively removes a record from the index, and leaves underlying storage as if the record was never indexed.  The only exception is when you are unindexing the *last* item in an index -- in that case, a few empty hashes and records are leftover (which are then reused if a new record is indexed again).

Remember that the indexer doesn't actually store your record data itself -- only index metadata.  If you want to also delete the record data, that is entirely up to your application.

Here is an example (see [Indexing Records](#indexing-records) above for details on the `config` object):

```js
storage.unindexRecord( "TICKET0001", config, function(err) {
	// record is completely removed from the index
	if (err) throw err;
} );
```

## Searching Records

To perform an index search, call the [searchRecords()](API.md#searchrecords) method and pass in a search query, your index configuration object, and a callback.  The search query can be in one of two different formats, which are both described below.  Your callback will be passed an Error object (or false on success), and a hash of all the matched record IDs.

Here is an example (see [Indexing Records](#indexing-records) above for details on the `config` object):

```js
storage.searchRecords( 'modified:2018/01/07 tags:bug', config, function(err, results) {
	// search complete
	if (err) throw err;
	
	// results will be hash of record IDs
	// { "TICKET0001": 1, "TICKET0002": 1 }
} );
```

This finds all records that were modified on Jan 7, 2018 **and** contain the tag `bug`.  This syntax is called a [simple query](#simple-queries), and is explained in detail below, along with the more complex [PxQL](#pxql-queries) syntax.

The search results are a hash of record IDs (just use the keys, ignore the values).  Note that the results are not sorted at this point.  If you need to sort them using an index sorter, you have to call [sortRecords()](API.md#sortrecords) as a secondary step.  See [Sorting Results](#sorting-results) below for details.

### Simple Queries

Simple queries are designed to be easy for users to type, but still provide adequate search functionality.  It is loosely based on some of the [GitHub Issue Search](https://help.github.com/articles/searching-issues-and-pull-requests/) syntax rules, essentially this part:

```
INDEX:WORDS [INDEX:WORDS ...]
```

Where `INDEX` is the ID of an index definition, and `WORDS` is one or more words to match in that index.  The pair can be repeated for multiple index searches (always in "AND" mode).  Here is a very simple query example:

```
status:open assigned:jhuckaby
```

This would find all records that contain the word `open` in their `status` index, **and** contain the word `jhuckaby` in their `assigned` index.  All words are matched case-insensitively, and follow all the index-specific rules like stemming, if enabled.

To specify multiple words for the same index and match any of them, use a pipe (`|`) delimiter, like this:

```
status:open assigned:jhuckaby|bsanders|hclinton
```

This would find all records that contain the word `open` in their `status` index, **and** contain any of the following words in their `assigned` index: `jhuckaby`, `bsanders` **or** `hclinton`.

Full-text fields have even more options.  For those, you can specify Google-style search queries, including negative word matches and exact (literal) matches for multi-word phrases.  Example:

```
body:wildlife +jungle "big cats" -bees
```

This would query the `body` index for all records that include the word `wildlife`, **and** the word `jungle` (the `+` prefix is redundant, but supported because it's Google-esque), **and** the phrase `big cats` (i.e. the word `cats` **must** appear just after the word `big`), but **not** any records that contain the word `bees`.

Note that negative word searches can only "take away" from a search result, so they must be accompanied by one or more normal (positive) word searches.

Dates must be specified in either `YYYY-MM-DD`, `MM-DD-YYYY` or Epoch (raw seconds) formats.  Slashes are also acceptable in addition to dashes.  Example:

```
status:open modified:2016-02-25
```

This would find all open records that were modified on February 25, 2016.

Both dates and numbers allow ranged searches.  Meaning, you can use  `>` (greater-than), `<` (less-than), `>=` (greater-or-equal) and `<=` (lesser-or-equal), as a prefix just before the date value.  Example:

```
status:open modified:>=2016-02-25
```

This would find all open records that were modified **on or after** February 25, 2016.

There is a shorthand available for closed range searches (i.e. records between two dates).  To use this, separate the two dates with two periods (`..`).  Both dates are inclusive.  Example:

```
status:open modified:2016-02-25..2016-12-31
```

This would find all open records that were modified **between** February 25, 2016 and December 31, 2016, inclusive.

Number indexes work in the same way as dates.  You can perform exact matches, and also range searches.  Example:

```
status:open num_comments:>=5
```

Simple queries were designed with user input in mind, like a Google search bar.  To that end, you can define a `default_search_field` property in your main index configuration, which designates one of your fields as the default to be used for searches if no field is specified.  For example, if you set the `default_search_field` to `body`, then you could accept queries like this:

```
wildlife +jungle "big cats" -bees
```

The idea here is, the user doesn't have to specify the `body:` prefix in their search.  They can just send in raw words, and `default_search_field` will detect this and redirect the query to the appropriate index.  This can, of course, be combined with other index searches with prefixes, such as:

```
wildlife +jungle "big cats" -bees status:open
```

### PxQL Queries

PxQL queries are more structured than simple ones, and allow for more complex logic and sub-queries in parenthesis.  It sort of resembles [SQL](https://en.wikipedia.org/wiki/SQL) syntax, but is much more rudimentary.  PxQL is identified by surrounding the entire query by parenthesis.  This style of query is geared more towards application usage, i.e. not raw user input.

The basic syntax is `(INDEX OPERATOR "VALUE")`, where `INDEX` is the ID of one of your indexed fields, `OPERATOR` is one of several operators (see below), and `"VALUE"` (always in quotes) is the word or words to match against.  Multiple expressions can be chained together with a logic separator `&` (AND) or `|` (OR).  Sub-queries should have nested inner parenthesis.

Here is a simple example:

```
(status = "open" & title = "Preproduction")
```

This would find all records that contain the word `open` in their `status` index, **and** contain the word `Preproduction` in their `title` index.  Note that the equals (`=`) operator really means "contains", as these are all word indexes.  For syntactic sugar, you can use `=~` instead of `=` which more resembles "contains".  To specify an exact phrase for a full-text index, simply include multiple words:

```
(status = "open" & title =~ "Released to Preproduction")
```

This would find all records that contain the word `open` in their `status` index, **and** contain the exact phrase `Released to Preproduction` in their `title` index.  This honors remove words and stemming if configured on the index, so queries do not need to be pre-filtered.

For negative word matches, use the `!~` operator, like this:

```
(status = "open" & title !~ "Released to Preproduction")
```

This would find all records that contain the word `open` in their `status` index, and **not** the exact phrase `Released to Preproduction` in their `title` index.

Here is a more complex example, with date ranges and nested sub-queries:

```
(modified >= "2016-02-22" & (title =~ "amazon" | title =~ "monitor") & (status = "open" | status = "closed" | status = "wallaby"))
```

This one makes more sense when formatted onto multiple lines (which is also acceptable PxQL):

```
(
	modified >= "2016-02-22" &
	(title =~ "amazon" | title =~ "monitor") & 
	(status = "open" | status = "closed" | status = "wallaby")
)
```

So here we have an outer group of three expressions matched with AND, and two sub-queries that use OR.  This would match all records that were modified on or after February 22, 2016, **and** the `title` contained *either* `amazon` or `monitor`, **and*** the `status` contained one of: `open`, `closed` or `wallaby`.  Basically, this is an outer group of "AND" matches, with inner "OR" matches, denoted with nested parenthesis.

In the example above, you can see that we're using `=` for searching the `status` index, but then `=~` for the `title` index.  This is entirely just syntactic sugar.  Both operators are functionally identical, and both mean "contains".  Double-equals (`==`) works too.

Here is the complete list of supported operators and their meanings:

| Operator | Description |
|----------|-------------|
| `=` | Contains |
| `==` | Contains |
| `=~` | Contains |
| `!~` | Does NOT contain |
| `>` | Greater than (dates and numbers only) |
| `<` | Less than (dates and numbers only) |
| `>=` | Greater or equal (dates and numbers only) |
| `<=` | Lesser or equal (dates and numbers only) |

The supported logic separators are `&` (AND) and `|` (OR).  You can substitute `&&` or `||` respectively.

### Fetching All Records

To fetch *all* records without using an index, use the special search query `*` (asterisk).  This is faster than performing an index search, as this simply fetches all the record keys from an internal master ID hash.  Example use:

```js
storage.searchRecords( '*', config, function(err, results) {
	// search complete
	if (err) throw err;
	
	// results will be hash of record IDs
	// { "TICKET0001": 1, "TICKET0002": 1 }
} );
```

## Sorting Results

Sorting your results is an optional, secondary operation, applied after searching is complete.  To do this, you first need to define special "sorter" definitions in your main configuration.  These tell the indexer which fields you will need to sort by.  Example:

```js
"sorters": [
	{
		"id": "username",
		"source": "/User",
		"type": "string"
	},
	{
		"id": "num_comments",
		"source": "/Comments/length",
		"type": "number"
	}
]
```

This would allow you to sort your records by the `User` property alphanumerically, and by the number of comments.  The latter assumes your data records have an array of comments in a `Comments` property, and this indexes the `length` of that array as a number sorter.

For sorting dates, you have two options.  Either provide the date as an Epoch timestamp and use a `number` sorter type, or provide it as an alphanumerically sortable date, like `YYYY-MM-DD` and use a `string` type.

To actually perform the sort, call the [sortRecords()](API.md#sortrecords) method, and provide the following 5 arguments:

- An unsorted hash of record IDs, as returned from [searchRecords()](API.md#searchrecords).
- The ID of the sorter field, e.g. `username`, `num_comments`.
- The sort direction, which should be `1` for ascending, or `-1` for descending (defaults to `1`).
- Your main index configuration object, containing the `sorter` array.
- A callback to receive the final sorted IDs.

Here is an example search and sort:

```js
storage.searchRecords( 'modified:2018/01/07 tags:bug', config, function(err, results) {
	// search complete
	if (err) throw err;
	
	// now sort the results by username ascending
	storage.sortRecords( results, 'username', 1, config, function(err, sorted) {
		// sort complete
		if (err) throw err;
		
		// sorted IDs will be in array
		// [ "TICKET0001", "TICKET0002", "TICKET0003" ]
	} ); // sortRecords
} ); // searchRecords
```

Given an array of your sorted record IDs, you can then implement your own pagination system (i.e. limit & offset), and load multiple records at at time via [getMulti()](API.md#getmulti) or other.

## Field Summaries

If you have any fields indexed with the [master list](#master-list) feature enabled, you can fetch a "summary" of the data values using the [getFieldSummary()](API.md#getfieldsummary) method.  This returns a hash containing all the unique words from the index, and their total counts (occurrences) in the data.  Example use:

```js
storage.getFieldSummary( 'status', config, function(err, values) {
	if (err) throw err;
	
	// values will contain a hash with word counts:
	// { "new": 4, "open": 45, "closed": 16, "assigned": 3 }
} );
```

Summaries work best for fields that contain a relatively small amount of unique words, such as a "status" field.  If the field contains more than 1,000 unique words or so, things might slow down, as the summary data has to be updated for every record.

## Bulk Reindexing

If you want to make changes to your index configuration, i.e. add or remove fields, then you will have to bulk reindex the data.  To do this, you need to [fetch all the record IDs](#fetching-all-records), and then iterate over them and issue the correct commands.  See below for specific examples, which all make use of the [async](https://www.npmjs.com/package/async) module for asynchronous array iteration.

### Adding Fields

To add a new field to your index, you simply have to apply the change to your index configuration, then call [indexRecord()](API.md#indexrecord) on all your records again.  The indexer is smart enough to know that all your existing field values haven't changed, but you have added a new one which needs to be indexed.  Example:

```js
var async = require('async');

// fetch all record ids
storage.searchRecords( '*', config, function(err, results) {
	if (err) throw err;
	
	// iterate over records
	async.eachSeries( Object.keys(results),
		function(id, callback) {
			// fetch record data from storage (your own path)
			storage.get( 'my/app/records/' + id, function(err, record) {
				if (err) return callback(err);
				
				// and reindex it
				storage.indexRecord( id, record, config, callback );
			} );
		},
		function(err) {
			// reindex complete
			if (err) throw err;
		}
	); // eachSeries
} ); // searchRecords
```

### Deleting Fields

To delete a field, the process is similar to adding one.  You will have to iterate over all your records, and call [indexRecord()](API.md#indexrecord) on each one, except this time we'll add a special `delete` property to the index you want to delete.  This tells the library to force a delete on reindex.  Here is an example:

```js
var async = require('async');

// mark the field you want to delete with a `delete` property
config.fields[2].delete = true;

// fetch all record ids
storage.searchRecords( '*', config, function(err, results) {
	if (err) throw err;
	
	// iterate over records
	async.eachSeries( Object.keys(results),
		function(id, callback) {
			// fetch record data from storage (your own path)
			storage.get( 'my/app/records/' + id, function(err, record) {
				if (err) return callback(err);
				
				// and reindex it
				storage.indexRecord( id, record, config, callback );
			} );
		},
		function(err) {
			// reindex complete
			if (err) throw err;
		}
	); // eachSeries
} ); // searchRecords
```

Once this reindex is complete, you can completely remove the index array entry from your configuration.

### Changing Fields

To change the settings for an index field, you must first unindex (delete) it, then reindex it.  This can be done by running the steps outlined in [Deleting Fields](#deleting-fields), followed by [Adding Fields](#adding-fields), in that order.

Make sure you leave the index field settings set to their old values when you add the `delete` property.  Then run through all records to unindex the field, remove the `delete` property, make your changes, and then reindex all records with the new settings.

## Performance Tips

- Use the local filesystem engine only, preferably a fast SSD.
- Crank up your [concurrency](../README.md#concurrency) setting to 4 or higher.
- Only index the fields you really need to search on.
- Only add sorters on the fields you really need to sort by.
- Make use of [Remove Words](#remove-words) and `min_word_length` for your full text fields.
- Make use of the [Stemmer](#stemming) for your full text fields.
- Only enable `master_list` on fields with a small number of unique words.
- Sorting is slow, consider using alphabetically sortable IDs, and sorting the records that way.
- Searching by date range and number range is very slow, try to avoid.
- Everything is slow, don't use this stupid library, LOL :)

## Indexer Internals

Indexes are essentially built on top of [Hashes](Hashes.md).  Each field value is distilled down to a list of words (possibly utilizing [remove words](#remove-words) and [stemming](#stemming)), and each unique word becomes a hash.  The hash keys are your record IDs, and the hash values are the locations within the record's word list where the word appears.  The latter is important for performing exact phrase searches.  Each search iterates over the appropriate hashes and combines all the matching record IDs.

A basic record indexed with the sample configuration detailed back in the [Indexing Records](#indexing-records) section looks like the following.  Note that this was created using a [raw filesystem](../README.md#raw-file-paths):

```
index/
 └ myapp/
    ├ _data/
    │  └ ticket0001.json
    ├ _id/
    │  └ data.json
    ├ _id.json
    ├ body/
    │  └ word/
    │     ├ bodi/
    │     │  └ data.json
    │     ├ bodi.json
    │     ├ contain/
    │     │  └ data.json
    │     ├ contain.json
    │     ├ html/
    │     │  └ data.json
    │     ├ html.json
    │     ├ line/
    │     │  └ data.json
    │     ├ line.json
    │     ├ mai/
    │     │  └ data.json
    │     ├ mai.json
    │     ├ multipl/
    │     │  └ data.json
    │     ├ multipl.json
    │     ├ nice/
    │     │  └ data.json
    │     ├ nice.json
    │     ├ text/
    │     │  └ data.json
    │     ├ text.json
    │     ├ thi/
    │     │  └ data.json
    │     ├ thi.json
    │     ├ ticket/
    │     │  └ data.json
    │     ├ ticket.json
    │     ├ which/
    │     │  └ data.json
    │     └ which.json
    ├ modified/
    │  ├ summary.json
    │  └ word/
    │     ├ 2018/
    │     │  └ data.json
    │     ├ 2018.json
    │     ├ 2018_01/
    │     │  └ data.json
    │     ├ 2018_01.json
    │     ├ 2018_01_07/
    │     │  └ data.json
    │     └ 2018_01_07.json
    └ tags/
       ├ summary.json
       └ word/
          ├ assigned/
          │  └ data.json
          ├ assigned.json
          ├ bug/
          │  └ data.json
          ├ bug.json
          ├ open/
          │  └ data.json
          └ open.json
```

The first thing to notice is that everything is under a base path of `index/myapp/...`.  This reflects the `base_path` property in your main configuration object.

So in our example configuration, we have three indexed fields: `body`, `modified` and `tags`.  As you can see in the data layout, each one occupies its own "namespace" in storage, and contains hashes for each unique value, and in some cases a [summary](#master-list) record as well.  For reference, here was our sample record ("TICKET0001") was was used to populate the indexes:

```js
var record = {
	"BodyText": "This is the body text of my ticket, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
	"ModifyDate": "2018/01/07",
	"Tags": "bug, assigned, open"
};
```

Let's take a closer look at the `tags` index storage layout:

```
index/
 └ myapp/
    └ tags/
       ├ summary.json
       └ word/
          ├ assigned/
          │  └ data.json
          ├ assigned.json
          ├ bug/
          │  └ data.json
          ├ bug.json
          ├ open/
          │  └ data.json
          └ open.json
```

Our sample record had three tags, `bug`, `assigned`, and `open`.  You can see that we have a hash for each unique word.  If you were to grab all the hash contents of the `index/myapp/tags/word/open` hash, you'd get this:

```js
{
	"TICKET0001": "3"
}
```

The value `3` means that the `open` tag was the 3rd word in the list for record `TICKET0001`.  This word placement ranking only comes into play with full-text fields, and when you are performing an exact phrase query (where one word must come right after another).

The `tags` field also has the [master_list](#master-list) property set, so a special `index/myapp/tags/summary` record was created.  This contains all the unique words for the index, and the occurrence counts of each.  Example:

```js
{
	"bug": 1,
	"assigned": 1,
	"open": 1
}
```

### Date and Number Fields

Date and number fields are still technically indexed as "words", but some internal trickery is applied to allow for range searches.  Essentially numbers and dates are placed into several range buckets.  Along with a [Master List](#master-list) which is automatically enabled for these fields, the system can search across a range of values.

For example, let's look at the `modified` field from our record:

```
index/
 └ myapp/
    └ modified/
       ├ summary.json
       └ word/
          ├ 2018/
          │  └ data.json
          ├ 2018.json
          ├ 2018_01/
          │  └ data.json
          ├ 2018_01.json
          ├ 2018_01_07/
          │  └ data.json
          └ 2018_01_07.json
```

Our record had a single date (2018/01/07) as the value for the `modified` field, but as you can see here, three separate words were actually indexed: `2018`, `2018_01` and `2018_01_07`.  These are the "buckets" used for date range searches.  So in addition to the exact date, all the records modified in the year 2018 will have the `2018` word indexed, and all the records modified in January 2018 will have the `2018_01` word indexed.  In this way the search engine can limit the values it needs to search for ranges.

Numbers are handled in very much the same way, by splitting up the value into buckets.  Specifically, the number is divided into 1000s and 100s (thousands and hundreds) and bucket words are created for each one.

Both dates and numbers automatically enable the [Master List](#master-list), so a `summary` record is always created for these field types.

### Special Metadata

In addition to all your named fields, the system also stores a number of metadata records, for internal bookkeeping.  There's the `_data` namespace, and the `_id` hash.  As a result, you cannot have any fields named `_data` or `_id`, to prevent collisions.  Example storage layout:

```
index/
 └ myapp/
    ├ _data/
    │  └ ticket0001.json
    ├ _id/
    │  └ data.json
    └ _id.json
```

The `_data/` namespace has a single record for each of your records, named using your normalized record ID (e.g. `_data/ticket0001`), which is used to hold a copy of all the internal data that the indexer used to index the record.  This is used when comparing indexes on update, to see what changed.  Example record:

```js
{
	"body": {
		"words": ["thi", "bodi", "text", "ticket", "which", "mai", "contain", "html", "multipl", "line"],
		"checksum": "c4bcffe1726097581e4fb9ca87de3254"
	},
	"modified": {
		"words": ["2018_01_07", "2018_01", "2018"],
		"checksum": "46d43ab288b06fe7bdbc67daafc6e06b"
	},
	"tags": {
		"words": ["bug", "assigned", "open"],
		"checksum": "819fb23452936cc03cafbf29f30b5935"
	}
}
```

The `_id` hash simply stores every unique record ID.  This is used solely for the purpose of bookkeeping, and also to iterate over all records, i.e. when the wildcard (`*`) search query comes in.
