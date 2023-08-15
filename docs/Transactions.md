# Transactions

A transaction is an isolated compound operation with atomic commit and rollback.  Using transactions you can execute a series of operations without affecting other views of the database until you commit, and then it all happens at once.  Commits are an "all or nothing" affair, providing atomicity.  They also provide a safe way to automatically rollback to a known good state in case of an error or crash.

The transaction system works with any storage engine, but it is optimized for the local filesystem.

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```javascript
var storage = server.Storage;
```

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md)

<!-- toc -->
- [Caveats](#caveats)
- [Configuration](#configuration)
- [Basic Use](#basic-use)
- [Aborting](#aborting)
- [Automatic API Wrappers](#automatic-api-wrappers)
- [Emergency Shutdown](#emergency-shutdown)
- [Recovery](#recovery)
- [Transaction Internals](#transaction-internals)
	* [Temporary Directory](#temporary-directory)
	* [Branch Process](#branch-process)
	* [Commit Process](#commit-process)
	* [Rollback Process](#rollback-process)

## Caveats

Transaction locking is advisory.  Meaning, transactions will all play nice with each other, ensuring isolation and atomicity, but you can "get around it" simply by calling one of the low-level write methods like [put()](API.md#put) on a storage path that intersects with a transaction in progress.  This would likely cause some undesired effects, especially if a commit or rollback is in the middle of executing.  In short, the system is designed with the assumption that your application will designate certain storage paths that will only be mutated using transactions.

The transaction system is designed for JSON records only.  Binary records are not included as part of a transaction, and operations are silently passed straight through.  Meaning, any calls accessing binary records inside of a transaction will result in the original record being changed.  This behavior may be changed in a future version.

Please note that transactions aren't 100% [ACID compliant](https://en.wikipedia.org/wiki/ACID), but they do follow *most* of the rules.  When using the local filesystem engine, the real question is durability, as in what happens in the event of a sudden power loss.  When a transaction is committed, by design it could involve changing a huge amount of files.  While this operation is "effectively atomic" by way of advisory locking, the filesystem may still end up in an unknown state after sudden reboot, for example in the middle of a very large commit.  Now, the system does have automatic recovery using a rollback log, and *should* be able to restore the filesystem to the state right before the commit.  But really, when we're talking about yanking power cords, lightning strikes and brown-outs, who the hell knows.  The rollback log may be incomplete or corrupted (yes, we call [fsync](https://nodejs.org/api/fs.html#fs_fs_fsync_fd_callback) on it before ever starting the commit, but even then, things can happen -- fsync isn't a 100% guarantee, especially with SSDs).

I guess the bottom line is, always keep backups of your data, and don't use this for anything mission critical.  It is really just a hobby project anyway.  The authors of this software are not responsible for any data loss!

## Configuration

The transaction system is configured by a few additional properties in the `Storage` object of your main application configuration file.  At a minimum, just set the `transactions` property to `true`, which will enable transaction support.  However, there are some other optional properties you can set as well.  Here is the full list:

| Property Name | Type | Description |
|---------------|------|-------------|
| `transactions` | Boolean | Set to `true` to enable transactions (defaults to `false`). |
| `trans_dir` | String | Path to temporary directory on local disk to store transactions in progress (see below). |
| `trans_auto_recover` | Boolean | Automatically recover from fatal errors on startup (see [Recovery](#recovery) below). |

Choose your `trans_dir` carefully.  This directory is used to store temporary files during a transaction.  The optimum value depends on the storage engine, and also possibly the underlying filesystem type:

| Storage Engine | Recommendation |
|----------------|----------------|
| Local Filesystem | Make sure your `trans_dir` is on the *same mount* as your local storage data, to ensure speed and safety.  This is the default. |
| NFS Filesystem | Make sure your `trans_dir` is **NOT** on the NFS mount, but instead points to a local fast SSD mount. |
| S3 or Couchbase | Make sure your `trans_dir` points to a local fast SSD mount. |

So basically, if you plan to use the [Filesystem](../README.md#local-filesystem) engine with a local (i.e. non-network) disk, you don't need to make any adjustments.  The default setting for `trans_dir` is a subdirectory just inside your `base_dir` engine property.  But if you are going with a networked (i.e. NFS) filesystem, or you're going to use [S3](../README.md#amazon-s3) or [Couchbase](../README.md#couchbase), then you should set `trans_dir` to a local filesystem path on a fast disk (ideally SSD).

**Pro-Tip:** When using transactions with the Amazon S3 engine, consider setting the `maxRetries` property in your `S3` configuration object, so the AWS client library makes multiple attempts before failing an operation.  Network hiccups can happen.

## Basic Use

You start a transaction by calling [begin()](API.md#begin).  This asynchronous method returns a special transaction object, which presents a "branch" or "view" of the database.  It is a proxy object upon which you can call any standard storage API methods, e.g. [put()](API.md#put), [get()](API.md#get), [delete()](API.md#delete) or other.  Any operations on the transaction object take place in complete isolation, separate from the main storage object.  When you're ready, call [commit()](API.md#commit) to complete the transaction, which applies all the changes to main storage.

Here is a very basic example:

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

The [begin()](API.md#begin) method accepts an arbitrary base storage path, which is used to obtain an exclusive lock.  This is to insure that only one transaction can be performed on a particular area of your storage data at a time.  The path doesn't necessarily have to exist.  

The [begin()](API.md#begin) method is asynchronous because obtaining a lock may have to wait on another active transaction using the same base path.  Calling [commit()](API.md#commit) (or [abort()](API.md#abort) -- see below) releases the lock, and completes the transaction.  At that point you should discard the `trans` object, as it can no longer be used.

Here is a more comprehensive example, which deposits a sum of money into a fictional bank account.  We are using the [async](https://www.npmjs.com/package/async) module for better flow control.

```js
var async = require('async');

storage.begin( 'accounts', function(err, trans) {
	// transaction has begun, now use 'trans' as storage proxy
	async.waterfall(
		[
			function(callback) {
				// load fictional bank account
				trans.get( 'accounts/jhuckaby', callback );
			},
			function(account, callback) {
				// make deposit
				account.balance += 500.00;
				
				// save account data
				trans.put( 'accounts/jhuckaby', account, callback );
			},
			function(callback) {
				// commit transaction
				trans.commit( callback );
			}
		],
		function (err) {
			if (err) {
				// error during transaction, abort it and roll back
				return trans.abort( function() {
					// rollback complete
				} );
			}
			
			// transaction is complete
			// accounts/jhuckaby is $500 richer!
		}
	);
});
```

So here we are beginning a transaction on path `accounts`, and then mutating an account record *under* this path, i.e. `accounts/jhuckaby`.  Inside of the transaction, we are loading the account, incrementing its balance, and saving it back out.  But nothing actually happens outside the transaction object until we commit it.  At that time our changes are applied to main storage, and the lock released.

You may be wondering why a global exclusive lock on the `accounts` path is necessary to simply make a deposit into one account.  Why not lock only the `accounts/jhuckaby` path, so multiple deposits into different accounts can all happen concurrently?  That would probably work fine in this example, but consider the case of transferring money between two accounts.  Your application may want both the withdraw *and* deposit to happen inside a single transaction, in which case you would probably want to obtain a global lock.

So what happens if another thread tries to load `accounts/jhuckaby` somewhere in the middle of the transaction, but using the main storage object?  Consider:

```js
storage.get( 'accounts/jhuckaby', function(err, account) {
	// what is account.balance here?
} );
```

The answer is either!  The account's balance may be its original value here, or it may be +500.00, depending on exactly when this code actually executed.  If the commit completed, it will reflect the new +500 value.  But if it ran anytime before that, it will be the old value.  All operations are atomic, so it will always be one or the other.

Depending on your application, the "proper" way to read an account balance may be to start another transaction using the same base transaction lock path, and then commit it with zero write operations (a zero-operation commit).  This way it has to wait for a lock, and will never run at the same time as an active transaction.  Example:

```js
storage.begin( 'accounts', function(err, trans) {
	// we have a lock
	trans.get( 'accounts/jhuckaby', function(err, account) {
		// read account.balance here
		trans.commit();
	} );
});
```

In this case we know the commit will be instant (zero operations) so we don't need to pass it a callback.  It'll release the lock in the same thread.

It is up to your application to decide when transactions and/or basic [locking](../README.md#advisory-locking) should be used.  Overusing global locks can be bad for performance, so if you can get away with calling a direct [get()](API.md#get) for reads then you should do it whenever possible.

## Aborting

If an error occurs during a transaction, you can call the [abort()](API.md#abort) method to cancel it and roll everything back (if any changes occurred).  This also releases the lock and renders the transaction object dead.  Example use:

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

It should be noted that if you receive an error from a [commit()](API.md#commit) call, it is *vital* that you call [abort()](API.md#abort) to undo whatever operations may have already executed.  A commit error is typically very bad, and your storage system will be in an unknown state.  Only by calling [abort()](API.md#abort) can you restore it to before the transaction started.

If the [abort()](API.md#abort) also fails, then the database raises a fatal error and exits immediately.  See [Emergency Shutdown](#emergency-shutdown) below for details about what this means, and [Recovery](#recovery) for how to get back up and running.  Examples of fatal errors include your disk running completely out of space, or a major network failure when using NFS, S3 or Couchbase.

## Automatic API Wrappers

When transactions are enabled, many compound storage methods (those that execute multiple sequential write operations) are automatically wrapped in a self-contained transaction, if one isn't already active.  Basically this includes all the [List](Lists.md), [Hash](Hashes.md) and [Index](Indexer.md) APIs that write data.  This makes everything *much* safer to use, because data won't ever become corrupted due to a power loss or crash during a multi-part operation.  These transaction wrappers will also self-abort (rollback) upon error.  Here is the full list of API methods that are automatically wrapped:

- **List Methods**
	- [listCreate()](API.md#listcreate)
	- [listPush()](API.md#listpush)
	- [listUnshift()](API.md#listunshift)
	- [listPop()](API.md#listpop)
	- [listShift()](API.md#listshift)
	- [listSplice()](API.md#listsplice)
	- [listDelete()](API.md#listdelete)
	- [listCopy()](API.md#listcopy)
	- [listRename()](API.md#listrename)
- **Hash Methods**
	- [hashCreate()](API.md#hashcreate)
	- [hashPut()](API.md#hashput)
	- [hashPutMulti()](API.md#hashputmulti)
	- [hashUpdate()](API.md#hashupdate)
	- [hashUpdateMulti()](API.md#hashupdatemulti)
	- [hashCopy()](API.md#hashcopy)
	- [hashRename()](API.md#hashrename)
	- [hashDeleteMulti()](API.md#hashdeletemulti)
	- [hashDeleteAll()](API.md#hashdeleteall)
	- [hashDelete()](API.md#hashdelete)
- **Indexer Methods**
	- [indexRecord()](API.md#indexrecord)
	- [unindexRecord()](API.md#unindexrecord)

You can still use these methods inside of your own transaction, and they will "join" it (they won't start their own sub-transaction).  However, they all still obtain and release their own locks, for an extra layer of safety.

## Emergency Shutdown

If a fatal storage error is encountered in the middle of an abort (rollback) operation, the database immediately shuts itself down.  This is because your data will be in an undefined state, stuck in the middle of partial transaction.  This should be a very rare event, only occurring when the underlying storage completely fails to write records.  Examples include a disk running out of space (local or NFS filesystem), or a hard network failure with S3 or Couchbase.  When this happens, the Node.js process will exit (by default), and will need to be recovered (see [Recovery](#recovery) below).

Upon fatal error, your application can hook the event and provide its own emergency shutdown procedure.  Simply add an event listener on the storage object for the `fatal` event.  It will be passed an `Error` object describing the actual error that occurred.  It is then up to your code to call `process.exit()`.  Example:

```js
storage.on('fatal', function(err) {
	// fatal storage error - emergency shutdown
	// alert the ops team here
	process.exit(1);
});
```

## Recovery

In the event of a fatal storage error, crash or sudden power loss, the database may be left in an "undefined" state.  Meaning, one or more transactions may have been in progress, or even in the middle of a commit.  To handle this, the system may need to perform recovery operations on startup.

By default, if the database experienced an unclean shutdown, it will not allow a normal startup.  It will exit immediately with this message on the console:

```
[YOUR_APP_NAME] was shut down uncleanly and needs to run database recovery operations.
Please start it in recovery mode by issuing this command:
	/path/to/your/app/start/cmd.js --recover
```

Adding the `--recover` command-line flag allows it to continue starting up, and then abort (rollback) any transactions that were active when it died.  It switches into "debug" mode during recovery (i.e. skips the background daemon fork), and echoes the main event log to the console, so you can see exactly what is happening.  When it is complete, another message will be printed to the console, and it will exit again:

```
Database recovery is complete.  Please see logs/recovery.log for full details.
[YOUR_APP_NAME] can now be started normally.
```

You can then start your application normally, i.e. without the `--recover` flag.  Alternatively, if you would prefer that the database automatically recovers and starts up on its own, just add the following property in your `Storage` configuration:

```js
{
	"trans_auto_recover": true
}
```

This will cause the recovery process to be completely automatic, perform everything during normal startup, and not require any additional restarts.  However, if you opt for this feature, it is recommended that you also monitor your application event logs, so you can see when/if a recovery event occurred.  All recovery operations are logged in a `recovery.log` file, which will be in the same directory as your other application logs (e.g. `log_dir` from pixl-server).

In addition, your application can optionally detect that a recovery took place on startup, and run further actions such as notifying the user.  To do this, look for a property on the `Storage` component named `recovery_count`.  If this property exists and is non-zero, then recovery operations took place, and the specified number of transactions were rolled back.  Furthermore, the path to the recovery log can be found in a property named `recovery_log`.  Example:

```js
// check for storage recovery
if (this.server.Storage.recovery_count) {
	this.sendSomeKindOfNotification("Database recovery took place.  See " + this.server.Storage.recovery_log + " for details.");
}
```

## Transaction Internals

The transaction system is implemented by temporarily "branching" the storage system into an isolated object with a dedicated temporary directory on disk.  Any operations performed on the branch are written to a temporary directory.  When the transaction is committed, the branch is "merged" back into main storage, with all operations tracked in a special rollback log which is discarded upon completion.

### Temporary Directory

A local temporary directory on disk is always used for transactions, regardless of the storage engine.  Even if you are using S3 or Couchbase for primary storage, transactions still use temp files on disk before and during commit.  This is to insure both speed and data safety.  You can control where the temporary files live by setting the `trans_dir` configuration property.

Inside the temp directory, two subdirectories are created: `data` and `logs`.  The `data` directory is used to hold all modified records during a transaction (before commit).  Each is named using a unique transaction ID (see below) and a hash of the original key.  This ensures no files will collide with each other, even with many concurrent transactions.  The `logs` directory is for rollback logs.  When a transaction is committed, the original state of the mutated records is written to the log, so it can be applied in reverse during a recovery event.

### Branch Process

When a transaction is first started, the only thing that happens is a unique ID is assigned, and a lock is obtained.  Both are based on the path that is passed into [begin()](API.md#begin).  Nothing is written to disk at this point -- that is deferred until actual operations are performed on the transaction object.

Each record that is mutated (created, updated or deleted) inside a transaction is written to a temporary file, and also a ledger is kept in memory to keep track of which records are changed.  The in-memory ledger only contains keys and a "state" character, representing a created, updated or deleted record.  Only records created or updated have an associated temp file on disk.  Deleted records are marked in memory only (no need for a temp file).

For example, consider a transaction that begins with path `test1`...

```js
storage.begin( 'test1', function(err, trans) {
	// transaction has begun
} );
```

The transaction ID will be `5a105e8b9d40e1329780d62ea2265d8a` (which is just an MD5 of `test1`).  Now, let's say our `trans_dir` was set to `/var/tmp/db`, and inside our transaction we store a record with key `test1/record1`...

```js
trans.put( 'test1/record1', { foo: 12345 }, function(err) {
	// record written inside transaction
} );
```

So at this point we wrote the `test1/record1` record using our `trans` object, but nothing has happened in the outer storage system (i.e. nothing was written to the primary storage engine).  Instead, the following temp file was written to disk, containing `{"foo":12345}`:

```
/var/tmp/db/data/5a105e8b9d40e1329780d62ea2265d8a-0d1454fd1bcdc024acedcbe5cfff4ffd.json
```

The temp filename is made up of the transaction ID (`5a105e8b9d40e1329780d62ea2265d8a`) and the MD5 hash of the record key (`0d1454fd1bcdc024acedcbe5cfff4ffd`).  This is to insure it will not collide with any other records in any other concurrent transactions, doesn't require any further subdirectories, and we can easily retrieve it at commit time if we know the plain key.

It should be noted that in these examples our record keys are *under* the `test1` base transaction path, e.g. `test1/record1`.  This is not required, as any record anywhere in storage can be read, written or deleted inside a transaction.  However, it keeps things much cleaner if you design your storage key layout in this way, especially with locking being completely advisory.  You want to ensure that your own application keeps its transaction-enabled records separate from non-transaction records (if any).  You can do this with a base key path like `test1/...` or some other method -- the storage system cares not.

The fact that we wrote to `test1/record1` is also noted in memory, in the transactions hash.  All the transaction keys are kept in memory, and the values are merely a state flag.  Here is the internal representation:

```js
"transactions": {
	"5a105e8b9d40e1329780d62ea2265d8a": {
		"id": "5a105e8b9d40e1329780d62ea2265d8a", 
		"path": "test1", 
		"date": 1514260380.343, 
		"pid": 9343,
		"keys": {
			"test1/record1": "W"
		},
		"queue": []
	}
}
```

In this case the state of the record is `W`, indicating "written".  If we deleted the record inside the transaction, the state would be `D`.  This ledger keeps track of all mutations, and is used to perform the actual commit.

Let's also delete a record just to see the internal representation.  Assuming `test1/deleteme` already existed before we started the transaction, we can do this:

```js
trans.delete( 'test1/deleteme', function(err) {
	// record deleted inside transaction
} );
```

This will not result in any temp file created on disk (although it will delete one if it already existed), but we do have to make a note in the transactions hash about the state of the deleted record:

```js
"keys": {
	"test1/record1": "W",
	"test1/deleteme": "D"
},
```

So now our transaction contains two mutations (operations).  One record written (has associated temp file), and one record deleted (no temp file).  Still, outside the transaction nothing has happened.  The `test1/deleteme` record still exists.

It is important to note that while some transaction metadata is kept in RAM, all the actual data is written to disk, as is the rollback log, and none of the metadata in RAM is required for recovery.  If you attempt a transaction containing hundreds of thousands of records, sure, it may cause a slowdown and memory bloat, but this database just isn't meant to scale that high.

Now let's see what happens if we fetch our `test1/record1` key, still inside the transaction and using the `trans` object...

```js
trans.get( 'test1/record1', function(err, data) {
	// record fetched inside transaction
	// data will be {"foo": 12345}
} );
```

Internally, the [get()](API.md#get) method is overridden, and the transaction layer intercepts the call.  First, we check the ledger, to see if the `test1/record1` key was branched, and in this case it was.  So instead of hitting primary storage, we simply load our temp file for the record, and return that value, since the state is `W`.  If the state is `D` (deleted inside transaction), then a `NoSuchKey` error is returned, just as if the record didn't exist in primary storage.  Alternatively, if `test1/record1` simply isn't in the transactions hash, the operation falls back to normal storage.

Similarly, if we try to fetch `test1/deleteme` using `trans`, we get an error:

```js
trans.get( 'test1/deleteme', function(err, data) {
	// record not found
	// err.code == "NoSuchKey"
} );
```

Even though the real `test1/deleteme` record still exists, our transaction "simulates" a deleted record by returning an error for the overridden [get()](API.md#get) method.

In this way, any records mutated inside the transaction are "branched" (written to temp files and/or added to the transaction ledger) and kept isolated until the transaction needs to be "merged" (committed), or possibly just discarded (transaction aborted before commit).

### Commit Process

The commit process basically replays all the transaction operations on primary storage, effectively "merging the branch".  However, it must do this in such a way so that a sudden crash or power loss at *any point* will still allow for full recovery, i.e. a clean rollback to the previous state.  To do this, we rely on a local rollback log, and of course [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html), to insure the log is actually written to physical disk (and not in the OS cache).

The log will contain the original JSON contents of all the records that will be mutated by the transaction.  It is basically a "snapshot" of the previous state, before we start the commit.  The log goes into the `logs` subdirectory under our `trans_dir` temp directory, and is named using the same Transaction ID hash:

```
/var/tmp/db/logs/5a105e8b9d40e1329780d62ea2265d8a.log
```

The log file format is plain text with line-delimited JSON for the records.  The first line is a header record that describes the transaction.  Here is an example log:

```
{"id":"5a105e8b9d40e1329780d62ea2265d8a","path":"test1","date":1514260380.343,"pid":9343}
{"key":"test1/record1","value":{"foo":12345}}
{"key":"test1/deleteme","value":0}
```

The header record is just a copy of the in-memory transaction metadata, minus the verbose key map and queue.  It's just used to identify the transaction, and for debugging purposes.  The rest of the lines are for all the mutated records.  Each record is wrapped in an outer JSON with a `key` and `value` property.  The `value` is the actual record JSON contents.  If the record was deleted, as was the case with `test1/deleteme`, then the value is set to `0`.

So here is the commit process, step by step:

- Write rollback log to local disk (see above).
- Call [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html) on the rollback log file, to flush it to physical disk.
- Call [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html) on the rollback directory as well, just to be 100% sure.
	- See the [fsync manpage](http://man7.org/linux/man-pages/man2/fsync.2.html) for details.
- Apply all transaction record changes to primary storage, as fast as possible.
	- This uses the storage [concurrency](../README.md#concurrency) configuration setting for parallelization.
	- When using the [Filesystem](../README.md#local-filesystem) engine, additional optimizations take place here.  The temp files are essentially just "renamed" into place (if possible), rather than being read and written again.
- Call [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html) on the temp `data` directory (where the temp files came from), to ensure they all get rewritten to disk as well, after their renames.
	- See this [Stack Overflow article](https://stackoverflow.com/questions/3764822/how-to-durably-rename-a-file-in-posix) for details.
	- This safety mechanism probably only has a real effect on local ext3/ext4 filesystems.
- Delete the rollback log.
- Remove transaction metadata from memory.
- Release the lock on the transaction base path.

The idea here is that no matter where a crash or sudden power loss occurs during the commit process, a full rollback can always be achieved.  The actual changes on the main storage system are only made once the rollback log is fully written and flushed to disk, and the log itself is only deleted when the record changes are also made (and flushed, where possible).

This is not a 100% guarantee of data durability, as corruption can happen during a crash or power loss.  The rollback log may only be partially written, or corrupted in some way where a replay is not possible.  This can happen because fsync calls are not guaranteed on all operating systems, filesystems or disk media (e.g. certain SSDs), and really all bets are off if you are using S3 or Couchbase for primary storage.

Basically it's all just a big crap shoot, but we're trying to cover as many error cases as possible.

### Rollback Process

There are two types of aborted transaction: one that happens before the commit (easy & safe), and one that happens as a result of an error *during* the commit (difficult & dangerous).  Let's take the easy one first.

When a transaction is aborted *before* commit, there is really nothing to roll back.  There is no rollback log, and nothing has touched primary storage yet.  Instead, we simply need to clean things up.  All the transaction temp files are deleted (if any), the in-memory transaction metadata is deleted, and the lock is released.  This kind of abort is typically user-driven, by calling [abort()](API.md#abort) in your application code.  It is typically quite safe, low risk and non-destructive to primary storage.

The other type of abort -- one that occurs as a result of an error, crash or power loss *during* a commit -- is more involved.  Here we have to basically "replay" the rollback log, and restore records to their original state.

The first step is to locate the rollback log.  It is named using the transaction ID hash, so we can easily find it if we are rolling back an active transaction in the same process (i.e. non-crash rollback).  However, for a full crash recovery, any and all leftover rollback logs are globbed, and then processed in order.

The rollback log is basically line-delimited JSON records, so we just have to open the file, and iterate over it, line by line.  Generally we skip over the first line (the file header), which is just metadata about the transaction.  This is only needed during a full crash recovery (see below).  Next, we process each line, which is a record to be restored to the specified JSON state, or deleted.  It should be noted that temp files are *not* used for rollback.  All the JSON record data is contained within the rollback log itself (this is why only JSON records are supported for transactions, and not binary records).

As noted above, during a full crash recovery we have no transaction metadata in memory (with the transaction ID, log file path, etc.).  To restore this internal state, we use the rollback log header (i.e. the first line).  This special JSON record is used to restore the internal metadata, so we have an active transaction that we are recovering.

The second phase of the rollback is cleanup.  Here we delete any temp files that may have been written as part of the transaction.  Temp files are only used for commit, not rollback, so we can just blindly delete them all.  For a non-crash rollback, we can use the in-memory `keys` hash to locate all the temp files.  For a full crash recovery, we just delete *all* temp files when recovery is complete (transaction temp files have their own directory).

Finally, the rollback log itself is deleted, the in-memory transaction metadata discarded, and the original lock is released (if applicable).  At this point storage has been restored to the state just before the commit, and everything should be happy.

Note that if a transaction abort operation fails due to a storage write failure, this is considered fatal.  The database immediately shuts down and issues a `fatal` error event.  We have to give up here because storage will be in an undefined state, and we should not attempt any further operations before a user addresses the underlying issue.  This is typically a disk that ran out of space, or some kind of "permanent" filesystem I/O error.  In the case of S3 or Couchbase, this would be a permanent network error.
