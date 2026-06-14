# Transactions

A transaction is an isolated compound operation with atomic commit and rollback.  Using transactions you can execute a series of operations without affecting other views of the database until you commit, and then it all happens at once.  Commits are an "all or nothing" affair, providing atomicity.  They also provide a safe way to automatically rollback to a known good state in case of an error or crash.

The transaction system works with any storage engine, including SQLite, S3-compatible object storage, Redis, Postgres and the local filesystem engine.

The code examples all assume you have your preloaded `Storage` component instance in a local variable named `storage`.  The component instance can be retrieved from a running server like this:

```js
let storage = server.Storage;
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
	* [Native Engine Commits](#native-engine-commits)
	* [Rollback Process](#rollback-process)

## Caveats

Transaction locking is advisory.  Meaning, transactions will all play nice with each other, ensuring isolation and atomicity, but you can "get around it" simply by calling one of the low-level write methods like [put()](API.md#put) on a storage path that intersects with a transaction in progress.  This would likely cause some undesired effects, especially if a commit or rollback is in the middle of executing.  In short, the system is designed with the assumption that your application will designate certain storage paths that will only be mutated using transactions.

The transaction system is designed for JSON records only.  Binary records are not included as part of a transaction, and operations are silently passed straight through.  Meaning, any calls accessing binary records inside of a transaction will result in the original record being changed.  This behavior may be changed in a future version.

Please note that transactions aren't 100% [ACID compliant](https://en.wikipedia.org/wiki/ACID), but they do follow *most* of the rules.  The main thing to understand is durability, as in what happens in the event of a sudden power loss, process crash, storage outage or network failure during a commit.  When a transaction is committed, by design it may involve changing a large number of records in your configured storage engine.  Engines that support native transactions, currently Postgres, can perform the commit using the engine's own atomic transaction system.  Other engines use the built-in rollback log system.  Both approaches are designed to make commits "all or nothing", but the real world still has teeth.  A rollback log may be incomplete or corrupted, or a remote database may lose the connection right as a native `COMMIT` is being decided.  When the system cannot safely determine or restore a known good state, it raises a fatal error rather than continuing with possibly inconsistent storage.

I guess the bottom line is, always keep backups of your data!

## Configuration

The transaction system is configured by a few additional properties in the `Storage` object of your main application configuration file.  At a minimum, just set the `transactions` property to `true`, which will enable transaction support.  However, there are some other optional properties you can set as well.  Here is the full list:

| Property Name | Type | Description |
|---------------|------|-------------|
| `transactions` | Boolean | Set to `true` to enable transactions (defaults to `false`). |
| `trans_dir` | String | Path to local directory for transaction rollback logs and recovery cleanup (see below). |
| `trans_auto_recover` | Boolean | Automatically recover from fatal errors on startup (see [Recovery](#recovery) below). |

Choose your `trans_dir` carefully.  This directory is used for rollback logs during commit, and those logs are what make crash recovery possible for engines using the built-in commit path.  Transaction record changes are kept in memory until commit time, but the rollback logs are still written to local disk and synced before the main storage engine is modified.  In modern deployments, the best choice is usually a fast, reliable local path on the same machine as your Node.js process:

| Storage Setup | Recommendation |
|---------------|----------------|
| Postgres | Postgres currently uses native database transactions during commit, so rollback logs are not used for successful commits.  You can still set `trans_dir` explicitly for consistency with other engines and future recovery behavior. |
| SQLite | The default is usually fine, because SQLite exposes a `base_dir`, and transactions will default to a `_transactions` directory inside it.  You can still set `trans_dir` explicitly if you want rollback logs on a different local volume. |
| S3 or S3-Compatible | Set `trans_dir` explicitly to a fast local disk path.  Do not place rollback logs in object storage. |
| Local Filesystem | The default is a `_transactions` subdirectory inside your local storage `base_dir`, which is usually a good choice. |
| Network Filesystem | Do not put `trans_dir` on the network mount.  Point it at a local fast SSD mount instead. |
| Other Remote Engines | Prefer a local disk path on the app server, rather than a remote or shared filesystem. |

If your storage engine exposes a `baseDir` internally, the default `trans_dir` is a `_transactions` subdirectory under that base path.  Otherwise, it defaults to a `transactions` directory under the current working directory.  For remote engines like S3-compatible storage, it is usually best to set this explicitly, so recovery-critical rollback logs are kept somewhere predictable, local and fast.

**Pro-Tip:** When using transactions with the Amazon S3 engine or an S3-compatible service, consider setting the `maxAttempts` property in your `S3` configuration object, so the AWS client library makes multiple attempts before failing an operation.  Network hiccups can happen.

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
const async = require('async');

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

It should be noted that if you receive an error from a [commit()](API.md#commit) call, it is *vital* that you call [abort()](API.md#abort) to undo whatever operations may have already executed.  A commit error is typically very bad, and your storage system may be in an unknown state.  Only by calling [abort()](API.md#abort) can you restore it to before the transaction started.

For engines that support native transactions, currently Postgres, most commit errors are rolled back inside the engine before the error is returned to your application.  You should still call [abort()](API.md#abort), because it cleans up the outer transaction metadata and releases locks.  If the native engine detects an unsafe outcome, such as a connection failure during `COMMIT` or a failed database rollback, the storage system raises a fatal error immediately instead of returning a normal commit error.

If the [abort()](API.md#abort) also fails, then the database raises a fatal error and exits immediately.  See [Emergency Shutdown](#emergency-shutdown) below for details about what this means, and [Recovery](#recovery) for how to get back up and running.  Examples of fatal errors include your disk running completely out of space, a SQLite write failure, or a major network failure when using a remote storage engine such as S3-compatible object storage.

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

If a fatal storage error is encountered in the middle of an abort (rollback) operation, the database immediately shuts itself down.  This is because your data will be in an undefined state, stuck in the middle of partial transaction.  This should be a very rare event, only occurring when the underlying storage completely fails to write records.  Examples include a disk running out of space, a local database write failure, or a hard network failure with a remote storage engine.

A fatal error can also be raised by a native engine commit path.  For example, Postgres can report a failure while the client is waiting for `COMMIT`, or it can fail while attempting to roll back a database transaction after an earlier commit error.  In these cases the application may not be able to prove whether the database committed or rolled back, so the safest response is to stop immediately and let an operator inspect the situation.

When this happens, the Node.js process will exit (by default), and may need to be recovered or investigated before restart (see [Recovery](#recovery) below).

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

Adding the `--recover` command-line flag allows it to continue starting up, and then abort (rollback) any transactions that were active when it died.  For the built-in rollback-log commit path, this means locating leftover rollback logs and replaying them.  For a native engine transaction that failed before a durable commit decision, the database engine should already have rolled back the transaction, and startup recovery may have no rollback log to process.  It switches into "debug" mode during recovery (i.e. skips the background daemon fork), and echoes the main event log to the console, so you can see exactly what is happening.  When it is complete, another message will be printed to the console, and it will exit again:

```
Database recovery is complete.  Please see logs/recovery.log for full details.
[YOUR_APP_NAME] can now be started normally.
```

You can then start your application normally, i.e. without the `--recover` flag.  Alternatively, if you would prefer that the database automatically recovers and starts up on its own, just add the following property in your `Storage` configuration:

```json
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

The transaction system is implemented by temporarily "branching" the storage system into an isolated object.  Any JSON writes performed on the branch are stored in memory, and any JSON deletes are tracked in memory as well.  Nothing is persisted to the main storage engine until the transaction is committed.  At commit time the branch is "merged" back into main storage.  Depending on the storage engine, the merge is protected either by pixl-server-storage's rollback log system, or by the engine's own native transaction system.

### Temporary Directory

A local transaction directory on disk is created regardless of the storage engine.  Modified JSON records live in memory until commit time.  For engines using the built-in commit path, the directory is mainly used for rollback logs, which are written and synced before any changes are applied to primary storage.  You can control where this directory lives by setting the `trans_dir` configuration property.

Inside the transaction directory, two subdirectories are created: `data` and `logs`.  The `logs` directory is the important one for engines using rollback logs.  When a transaction is committed through that path, the original state of the mutated records is written to a rollback log, so it can be applied in reverse during a recovery event.  The `data` directory is created for maintenance and recovery cleanup, but current JSON transaction writes do not use it.  Engines that provide native transaction commits, currently Postgres, do not write rollback logs for their normal commit path.

### Branch Process

When a transaction is first started, the only thing that happens is a unique sequential ID is assigned, and a lock is obtained.  The lock is based on the path that is passed into [begin()](API.md#begin).  Nothing is written to disk at this point.

Each JSON record that is mutated (created, updated or deleted) inside a transaction is tracked in memory.  The transaction keeps a `keys` ledger, which maps each touched key to a "state", representing a written or deleted record.  Written records also have their full JSON value stored in a `values` hash in memory.  Deleted records are marked in the ledger only.

For example, consider a transaction that begins with path `test1`...

```js
storage.begin( 'test1', function(err, trans) {
	// transaction has begun
} );
```

The transaction ID will be a sequential number such as `1`.  Now, let's say inside our transaction we store a record with key `test1/record1`...

```js
trans.put( 'test1/record1', { foo: 12345 }, function(err) {
	// record written inside transaction
} );
```

So at this point we wrote the `test1/record1` record using our `trans` object, but nothing has happened in the outer storage system (i.e. nothing was written to the primary storage engine).  Instead, the JSON value is kept in memory as part of the active transaction, along with its modification time and byte length.

It should be noted that in these examples our record keys are *under* the `test1` base transaction path, e.g. `test1/record1`.  This is not required, as any record anywhere in storage can be read, written or deleted inside a transaction.  However, it keeps things much cleaner if you design your storage key layout in this way, especially with locking being completely advisory.  You want to ensure that your own application keeps its transaction-enabled records separate from non-transaction records (if any).  You can do this with a base key path like `test1/...` or some other method -- the storage system cares not.

The fact that we wrote to `test1/record1` is also noted in memory, in the transactions hash.  Active transactions are keyed by the transaction base path, and each transaction has both a `keys` ledger and a `values` hash for written records.  Here is a simplified internal representation:

```js
"transactions": {
	"test1": {
		"id": "1",
		"path": "test1",
		"log": "/tmp/db/logs/9343-1.log",
		"date": 1514260380.343,
		"pid": 9343,
		"keys": {
			"test1/record1": "W"
		},
		"values": {
			"test1/record1": {
				"mod": 1514260380.456,
				"len": 13,
				"data": { "foo": 12345 }
			}
		},
		"queue": []
	}
}
```

In this case the state of the record is `W`, indicating "written".  If we deleted the record inside the transaction, the state would be `D`.  This ledger keeps track of all mutations, and is used to perform the actual commit.  The `values` hash holds a copy of the JSON data for all records currently in the `W` state.

Let's also delete a record just to see the internal representation.  Assuming `test1/deleteme` already existed before we started the transaction, we can do this:

```js
trans.delete( 'test1/deleteme', function(err) {
	// record deleted inside transaction
} );
```

This does not write anything to disk, but we do have to make a note in the transactions hash about the state of the deleted record:

```js
"keys": {
	"test1/record1": "W",
	"test1/deleteme": "D"
},
```

So now our transaction contains two mutations (operations).  One record written in memory, and one record deleted in memory.  Still, outside the transaction nothing has happened.  The `test1/deleteme` record still exists.

It is important to note that active transaction writes are kept in RAM until commit time.  If you plan to issue large transactions, make sure your Node.js process has enough memory allocated to hold all pending writes until commit.  For the built-in commit path, the rollback log is written to disk during commit, and none of the in-memory transaction metadata is required for crash recovery once the rollback log exists.  For native engine commits, the in-memory transaction metadata is passed to the engine at commit time, and the engine is responsible for applying the final set of changes atomically.

Now let's see what happens if we fetch our `test1/record1` key, still inside the transaction and using the `trans` object...

```js
trans.get( 'test1/record1', function(err, data) {
	// record fetched inside transaction
	// data will be {"foo": 12345}
} );
```

Internally, the [get()](API.md#get) method is overridden, and the transaction layer intercepts the call.  First, we check the ledger, to see if the `test1/record1` key was branched, and in this case it was.  So instead of hitting primary storage, we return a copy of the in-memory value from the transaction, since the state is `W`.  If the state is `D` (deleted inside transaction), then a `NoSuchKey` error is returned, just as if the record didn't exist in primary storage.  Alternatively, if `test1/record1` simply isn't in the transaction ledger, the operation falls back to normal storage.

Similarly, if we try to fetch `test1/deleteme` using `trans`, we get an error:

```js
trans.get( 'test1/deleteme', function(err, data) {
	// record not found
	// err.code == "NoSuchKey"
} );
```

Even though the real `test1/deleteme` record still exists, our transaction "simulates" a deleted record by returning an error for the overridden [get()](API.md#get) method.

In this way, any records mutated inside the transaction are "branched" in memory and kept isolated until the transaction needs to be "merged" (committed), or possibly just discarded (transaction aborted before commit).

### Commit Process

The commit process basically replays all the transaction operations on primary storage, effectively "merging the branch".  The outer transaction system always owns the branch, the advisory locks, the in-memory ledger, and the public `commitStart` / `commitEnd` events.  The actual storage commit can happen in one of two ways:

- If the engine provides a native `commitTransaction()` method, pixl-server-storage hands the full transaction object to the engine and lets it perform the durable commit atomically.
- Otherwise, pixl-server-storage uses its built-in rollback log system, described below.

The built-in commit path must be able to survive a sudden crash or power loss at *any point* and still allow for full recovery, i.e. a clean rollback to the previous state.  To do this, we rely on a local rollback log, and of course [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html), to insure the log is actually written to physical disk (and not in the OS cache).

The log will contain the original JSON contents of all the records that will be mutated by the transaction.  It is basically a "snapshot" of the previous state, before we start the commit.  The log goes into the `logs` subdirectory under our `trans_dir` transaction directory, and is named using the process ID and transaction ID:

```
/tmp/db/logs/9343-1.log
```

The log file format is plain text with line-delimited JSON for the records.  The first line is a header record that describes the transaction.  Here is an example log:

```
{"id":"1","path":"test1","log":"/tmp/db/logs/9343-1.log","date":1514260380.343,"pid":9343}
{"key":"test1/record1","value":0}
{"key":"test1/deleteme","value":{"old":true}}
```

The header record is just a copy of the in-memory transaction metadata, minus the verbose key map, in-memory values and queue.  It's used to identify the transaction during recovery, and for debugging purposes.  The rest of the lines are for all the mutated records.  Each record is wrapped in an outer JSON with a `key` and `value` property.  The `value` is the original record JSON contents from before the commit began.  If the record did not exist before the transaction, then the value is set to `0`, as shown for `test1/record1` above.  If a record is being deleted, and it existed before the transaction, then its original JSON value is written to the log so rollback can restore it.

So here is the built-in rollback-log commit process, step by step:

- Write rollback log to local disk (see above).
- Call [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html) on the rollback log file, to flush it to physical disk.
- Call [fsync](http://man7.org/linux/man-pages/man2/fsync.2.html) on the rollback directory as well, just to be 100% sure.
	- See the [fsync manpage](http://man7.org/linux/man-pages/man2/fsync.2.html) for details.
- Apply all transaction record changes to primary storage, as fast as possible.
	- This uses the storage [concurrency](../README.md#concurrency) configuration setting for parallelization.
	- Written records are applied from the transaction's in-memory `values` hash.
	- Deleted records are deleted directly from primary storage.
- If the storage engine provides a `sync()` method, enqueue post-commit sync calls for all written keys.
- Delete the rollback log.
- Remove transaction metadata from memory.
- Release the lock on the transaction base path.

The idea here is that no matter where a crash or sudden power loss occurs during this built-in commit process, a full rollback can be attempted.  The actual changes on the main storage system are only made once the rollback log is fully written and flushed to disk, and the log itself is only deleted when the record changes are also made and synced where possible.

This is not a 100% guarantee of data durability, as corruption can happen during a crash or power loss.  The rollback log may only be partially written, or corrupted in some way where a replay is not possible.  This can happen because fsync calls are not guaranteed on all operating systems, filesystems or disk media (e.g. certain SSDs), and remote storage engines may fail independently of the local process.  For example, an S3-compatible service may accept some writes and fail others during a network or service outage.

Basically it's all just a big crap shoot, but we're trying to cover as many error cases as possible.

### Native Engine Commits

Some storage engines can provide their own atomic commit support.  When this is available, the engine's native transaction system replaces the built-in rollback-log commit path entirely.  The outer pixl-server-storage transaction still works the same way while the transaction is active: writes and deletes are kept in memory, reads see the branched view, and nothing is sent to primary storage until commit time.

At commit time, the outer transaction layer detects the engine hook and calls the engine's `commitTransaction()` method, passing the full transaction object.  No rollback log is written, no rollback log directory is synced, and no local disk commit log is used for this path.  The engine is responsible for applying the final set of record writes and deletes atomically.

Postgres currently supports this native commit path.  It checks out one client from the `pg.Pool`, starts a PostgreSQL transaction with `BEGIN`, applies all final deletes and writes using set-based SQL statements, and then issues `COMMIT`.  The single checked-out client is important, because PostgreSQL transactions are connection-scoped.  The bulk SQL statements are important too, because they avoid one network round trip per record during commit.

If a Postgres statement fails before `COMMIT`, the engine attempts a PostgreSQL `ROLLBACK`, then returns the original error to the outer transaction system.  Your application should still call [abort()](API.md#abort) on the transaction object, so pixl-server-storage can discard the in-memory branch and release its locks.

If Postgres reports an error during `COMMIT`, or if the PostgreSQL `ROLLBACK` itself fails, the engine marks the error as fatal.  This is because the application may not be able to prove whether the database committed or rolled back, and there is no pixl-server-storage rollback log for this path.  The outer transaction system responds by raising a fatal storage error immediately.

After a successful native commit, pixl-server-storage updates its own in-process RAM cache, emits the usual per-record `put` / `delete` events, writes the normal transaction log entries, removes the transaction metadata from memory, and releases the transaction locks.  This keeps application-facing behavior consistent with engines that use the built-in rollback-log path.

### Rollback Process

There are two types of aborted transaction: one that happens before the commit (easy & safe), and one that happens as a result of an error *during* the commit (difficult & dangerous).  Let's take the easy one first.

When a transaction is aborted *before* commit, there is really nothing to roll back.  There is no rollback log, and nothing has touched primary storage yet.  Instead, we simply need to clean things up.  The in-memory key ledger, values hash and queue are discarded, and the lock is released.  This kind of abort is typically user-driven, by calling [abort()](API.md#abort) in your application code.  It is typically quite safe, low risk and non-destructive to primary storage.

The other type of abort -- one that occurs as a result of an error, crash or power loss *during* a built-in rollback-log commit -- is more involved.  Here we have to basically "replay" the rollback log, and restore records to their original state.

The first step is to locate the rollback log.  It is named using the process ID and transaction ID, so we can easily find it if we are rolling back an active transaction in the same process (i.e. non-crash rollback).  However, for a full crash recovery, any and all leftover rollback logs are globbed and processed in reverse order.

The rollback log is basically line-delimited JSON records, so we just have to open the file, and iterate over it, line by line.  Generally we skip over the first line (the file header), which is just metadata about the transaction.  This is only needed during a full crash recovery (see below).  Next, we process each line, which is a record to be restored to the specified JSON state, or deleted.  Rollback uses the log contents directly, because all the JSON record data is contained within the rollback log itself (this is why only JSON records are supported for transactions, and not binary records).

As noted above, during a full crash recovery we have no transaction metadata in memory (with the transaction ID, log file path, etc.).  To restore this internal state, we use the rollback log header (i.e. the first line).  This special JSON record is used to restore the internal metadata, so we have an active transaction that we are recovering.

The second phase of the rollback is cleanup.  The rollback log itself is deleted, the in-memory transaction metadata is discarded, and the original lock is released (if applicable).  During startup recovery, the system also clears the transaction `data` directory.

At this point storage has been restored to the state just before the commit, and everything should be happy.

For a native engine commit, such as Postgres, rollback is handled differently.  If the engine can prove that its native database transaction was rolled back, then pixl-server-storage only needs to discard its in-memory transaction branch and release locks.  If the engine cannot prove this, such as a connection failure during `COMMIT` or a failed database rollback, the engine marks the error as fatal and pixl-server-storage shuts down immediately.

Note that if a transaction abort operation fails due to a storage write failure, this is considered fatal.  The database immediately shuts down and issues a `fatal` error event.  We have to give up here because storage will be in an undefined state, and we should not attempt any further operations before a user addresses the underlying issue.  This is typically a disk that ran out of space, a local database write failure, or a persistent remote storage error.
