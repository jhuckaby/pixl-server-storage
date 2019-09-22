# Lists

A list is a collection of JSON records which can grow or shrink at either end, and supports fast random access.  It's basically a double-ended linked list, but implemented internally using "pages" of N records per page, and each page can be randomly accessed.  This allows for great speed with pushing, popping, shifting, unshifting, and random access, with a list of virtually any size.  Methods are also provided for iterating, searching and splicing, but those often involve reading / writing many pages, so use with caution.

All list operations will automatically lock the list using [Advisory Locking](../README.md#advisory-locking) (shared locks or exclusive locks, depending on if the operation is read or write), and unlock it when complete.  This is because all list operations involve multiple concurrent low-level storage calls.  Lists can be used inside [Transactions](Transactions.md) as well.

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)

<!-- toc -->
- [List Page Size](#list-page-size)
- [Creating Lists](#creating-lists)
- [Pushing, Popping, Shifting, Unshifting List Items](#pushing-popping-shifting-unshifting-list-items)
- [Fetching List Items](#fetching-list-items)
- [Splicing Lists](#splicing-lists)
- [Sorted Lists](#sorted-lists)
- [Iterating Over List Items](#iterating-over-list-items)
- [Updating List Items](#updating-list-items)
- [Searching Lists](#searching-lists)
- [Copying and Renaming](#copying-and-renaming)
- [Deleting Lists](#deleting-lists)
- [List Internals](#list-internals)

## List Page Size

List items are stored in groups called "pages", and each page can hold up to N items (the default is 50).  The idea is, when you want to store or fetch multiple items at once, the storage engine only has to read / write a small amount of records.  The downside is, fetching or storing a single item requires the whole page to be loaded and saved, so it is definitely optimized for batch operations.

You can configure how many items are allowed in each page, by changing the default [page size](../README.md#list_page_size) in your storage configuration, or setting it per list by passing an option to [listCreate()](API.md#listcreate).

Care should be taken when calculating your list page sizes.  It all depends on how large your items will be, and how many you will be storing / fetching at once.  Note that you cannot easily change the list page size on a populated list (this may be added as a future feature).

## Creating Lists

To create a list, call [listCreate()](API.md#listcreate).  Specify the desired key, options, and a callback function.  You can optionally pass in a custom page size via the second argument (otherwise it'll use the default size):

```javascript
storage.listCreate( 'list1', { page_size: 100 }, function(err) {
	if (err) throw err;
} );
```

You can also store your own key/value pairs in the options object, which are retrievable via the [listGetInfo()](API.md#listgetinfo) method.  However, beware of name collision -- better to prefix your own option keys with something unique.

## Pushing, Popping, Shifting, Unshifting List Items

Lists can be treated as arrays to a certain extent.  Methods are provided to [push](API.md#listpush), [pop](API.md#listpop), [shift](API.md#listshift) and [unshift](API.md#listunshift) items, similar to standard array methods.  These are all extremely fast operations, even with huge lists, as they only read/write the pages that are necessary.  Note that all list items must be objects (they cannot be other JavaScript primitives).

Examples:

```javascript
// push onto the end
storage.listPush( 'list1', { username: 'tsmith', age: 25 }, function(err) {
	if (err) throw err;
} );

// pop off the end
storage.listPop( 'list1', function(err, item) {
	if (err) throw err;
} );

// shift off the beginning
storage.listShift( 'list1', function(err, item) {
	if (err) throw err;
} );

// unshift onto the beginning
storage.listUnshift( 'list1', { username: 'fwilson', age: 40 }, function(err) {
	if (err) throw err;
} );
```

Furthermore, the [listPush()](API.md#listpush) and [listUnshift()](API.md#listunshift) methods also accept multiple items by passing an array of objects, so you can add in bulk.

## Fetching List Items

Items can be fetched from lists by calling [listGet()](API.md#listget), and specifying an index offset starting from zero.  You can fetch any number of items at a time, and the storage engine will figure out which pages need to be loaded.  To fetch items from the end of a list, use a negative index.  Example use:

```javascript
storage.listGet( 'list1', 40, 5, function(err, items) {
	if (err) throw err;
} );
```

This would fetch 5 items starting at item index 40 (zero-based).  To fetch the entire list, set the index and length to zero:

```javascript
storage.listGet( 'list1', 0, 0, function(err, items) {
	if (err) throw err;
} );
```

## Splicing Lists

You can "splice" a list just like you would an array.  That is, cut a chunk out of a list at any location, and optionally replace it with a new chunk, similar to the built-in JavaScript [Array.splice()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice) function.  [listSplice()](API.md#listsplice) is a highly optimized method which only reads/writes the pages it needs, but note that if the list length changes as a result of your splice (i.e. you insert more or less than you remove) it does have to rewrite multiple pages up to the nearest end page, to take up the slack or add new pages.  So please use with caution on large lists.

Here is an example which removes 2 items at index 40, and replaces with 2 new items:

```javascript
var new_items = [
	{ username: 'jhuckaby', age: 38, gender: 'male' },
	{ username: 'sfields', age: 34, gender: 'female' }
];
storage.listSplice( 'list1', 40, 2, new_items, function(err, items) {
	if (err) throw err;
	// 'items' will contain the 5 removed items
} );
```

You don't have to insert the same number of items that you remove.  You can actually remove zero items, and only insert new ones at the specified location.

As with [listGet()](API.md#listget) you can specify a negative index number to target items from the end of the list, as opposed to the beginning.

## Sorted Lists

While it is possible to manually sort your list by fetching all the items as an array, sorting it in memory, then rewriting the entire list, this can be quite time consuming.  Instead, you can perform a [listInsertSorted()](API.md#listinsertsorted) when adding items to a list.  This will find the correct location for a single item based on sorting criteria, and then splice it into place, keeping the list sorted as you go.  Example:

```javascript
var new_user = {
	username: 'jhuckaby', 
	age: 38, 
	gender: 'male' 
};

storage.listInsertSorted( 'users', new_user, ['username', 1], function(err) {
	if (err) throw err;
	// item inserted successfully
} );
```

That third argument is an array of sort criteria, consisting of the property name to sort by (e.g. `username`) and a sort direction (`1` for ascending, `-1` for descending).  You can alternately specify a comparator function here, which is called with the item you are inserting, and the item to compare it to.  This is similar to the built-in [Array.sort()](), which should return `1` or `-1` depending on if your item should come after, or before, the second item.  Example:

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

For large lists, this can still take considerable time, as it is iterating over the list to locate the correct location, and then performing a splice which grows the list, requiring all the remaining pages to be rewritten.  So please use with caution.

## Iterating Over List Items

Need to iterate over the items in your list, but don't want to load the entire thing into memory?  Use the [listEach()](API.md#listeach) method.  Example:

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

Your iterator function is passed the item and a special callback function, which must be called when you are done with the current item.  Pass it an error if you want to prematurely abort the loop, and jump to the final callback (the error will be passed through to it).  Otherwise, pass nothing to the iterator callback, to notify all is well and you want the next item in the list.

Alternatively, you can use [listEachPage()](API.md#listeachpage), which iterates over the internal list [pages](#list-page-size), and only fires your iterator function once per page, instead of once per item.  This is typically faster as it requires fewer function calls.  Example:

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

## Updating List Items

To iterate over and possibly update items, you can use the [listEachUpdate()](API.md#listeachupdate) method.  Your iterator callback accepts a second boolean argument which can indicate that you made changes.  Example:

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

As you can see, the iterator callback accepts two arguments, an error (or something false for success), and a boolean which should be set to `true` if you made changes.  The storage engine uses this to decide which list pages require updating.

For a speed optimization, you can optionally iterate over entire list [pages](#list-page-size) rather than individual items.  To do this, use the [listEachPageUpdate()](API.md#listeachpageupdate) method.  In this case your iterator callback is passed an array of items on each page.  Example:

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

## Searching Lists

Several methods are provided for searching through lists for items matching a set of criteria.  Use [listFind()](API.md#listfind) to find and retrieve a single item, [listFindCut()](API.md#listfindcut) to find and delete, [listFindReplace()](API.md#listfindreplace) to find and replace, [listFindUpdate()](API.md#listfindupdate) to find and apply updates, or [listFindEach()](API.md#listfindeach) to find multiple items and iterate over them.

All of these methods accept a "criteria" object, which may have one or more key/value pairs.  These must *all* match a list item for it to be selected.  For example, if you have a list of users, and you want to find a male with blue eyes, you would pass a criteria object similar to this:

```javascript
{
	gender: "male",
	eyes: "blue"
}
```

Alternatively, you can use regular expression objects for the criteria values, for more complex matching.  Example:

```javascript
{
	gender: /^MALE$/i,
	eyes: /blu/
}
```

Example of finding a single object with [listFind()](API.md#listfind):

```javascript
storage.listFind( 'list1', { username: 'jhuckaby' }, function(err, item, idx) {
	if (err) throw err;
} );
```

Example of finding and deleting a single object with [listFindCut()](API.md#listfindcut):

```javascript
storage.listFindCut( 'list1', { username: 'jhuckaby' }, function(err, item) {
	if (err) throw err;
} );
```

Example of finding and replacing a single object with [listFindReplace()](API.md#listfindreplace):

```javascript
var criteria = { username: 'jhuckaby' };
var new_item = { username: 'huckabyj', foo: 'bar' };

storage.listFindReplace( 'list1', criteria, new_item, function(err) {
	if (err) throw err;
} );
```

Example of finding and updating a single object with [listFindUpdate()](API.md#listfindupdate):

```javascript
var criteria = { username: 'jhuckaby' };
var updates = { gender: 'male', age: 38 };

storage.listFindUpdate( 'list1', criteria, updates, function(err, item) {
	if (err) throw err;
} );
```

You can also increment or decrement numerical properties with [listFindUpdate()](API.md#listfindupdate).  If an item key exists and is a number, you can set any update key to a string prefixed with `+` (increment) or `-` (decrement), followed by the delta number (int or float), e.g. `+1`.  So for example, imagine a list of users, and an item property such as `number_of_logins`.  When a user logs in again, you could increment this counter like this:

```javascript
var criteria = { username: 'jhuckaby' };
var updates = { number_of_logins: "+1" };

storage.listFindUpdate( 'list1', criteria, updates, function(err, item) {
	if (err) throw err;
} );
```

And finally, here is an example of finding *all* items that match our criteria using [listFindEach()](API.md#listfindeach), and iterating over them:

```javascript
storage.listFindEach( 'list1', { gender: 'male' }, function(item, idx, callback) {
	// do something with item, then fire callback
	callback();
}, 
function(err) {
	if (err) throw err;
	// all matched items iterated over
} );
```

## Copying and Renaming

To duplicate a list and all of its items, call [listCopy()](API.md#listcopy), specifying the old and new key.  Example:

```javascript
storage.listCopy( 'list1', 'list2', function(err) {
	if (err) throw err;
} );
```

To rename a list, call [listRename()](API.md#listrename).  This is basically just a [listCopy()](API.md#listcopy) followed by a [listDelete()](API.md#listdelete).  Example:

```javascript
storage.listRename( 'list1', 'list2', function(err) {
	if (err) throw err;
} );
```

With both of these functions, it is highly recommended you make sure the destination (target) key is empty before copying or renaming onto it.  If a list already exists at the destination key, it will be overwritten, but if the new list has differently numbered pages, some of the old list pages may still exist and occupy space, detached from their old parent list.  So it is always safest to delete first.

## Deleting Lists

To delete a list and all of its items, call [listDelete()](API.md#listdelete).  The second argument should be a boolean set to `true` if you want the list *entirely* deleted including the header (options, page size, etc.), or `false` if you only want the list *cleared* (delete the items only, leaving an empty list behind).  Example:

```javascript
storage.listDelete( 'list1', true, function(err) {
	if (err) throw err;
	// list is entirely deleted
} );
```

## List Internals

Lists consist of a header record, plus additional records for each page.  The header is literally just a simple JSON record, stored at the exact key specified for the list.  So if you created an empty list with key `mylist`, and then you fetched the `mylist` record using a simple [get()](API.md#get), you'd see this:

```javascript
{
	type: 'list',
	length: 0,
	page_size: 50,
	first_page: 0,
	last_page: 0
}
```

This is the list header record, which defines the list and its pages.  Here are descriptions of the header properties:

| Property | Description |
|----------|-------------|
| `type` | A static identifier, which will always be set to `list`. |
| `length` | How many items are currently in the list. |
| `page_size` | How many items are stored per page. |
| `first_page` | The page number of the beginning of the list, zero-based. |
| `last_page` | The page number of the end of the list, zero-based. |

The list pages are stored as records "under" the main key, by adding a slash, followed by the page number.  So if you pushed one item onto the list, the updated header record would look like this:

```javascript
{
	type: 'list',
	length: 1,
	page_size: 50,
	first_page: 0,
	last_page: 0
}
```

Notice that the `first_page` and `last_page` are both still set to `0`, even though we added an item to the list.  That's because pages are zero-based, and the algorithm will fill up page `0` (`50` items in this case) before adding a new page.

So then if you then fetched the key `mylist/0` you'd actually get the raw page data, which is a JSON record with an `items` array:

```javascript
{
	items: [
		{ username: "jhuckaby", gender: "male" }
	]
}
```

This array will keep growing as you add more items.  Once it reaches 50, however, the next item pushed will go into a new page, with key `mylist/1`.  That's basically how the paging system works.

Remember that lists can grow from either end, so if the first page is filled and you *unshift* another item, it actually adds page `mylist/-1`.

The two "end pages" can have a variable amount of items, up to the `page_size` limit.  The algorithm then creates new pages as needed.  But the *inner* pages that exist between the first and last pages will *always* have the full amount of items (i.e. `page_size`).  Never more, never less.  So as future list operations are executed, the system will always maintain this rule.
