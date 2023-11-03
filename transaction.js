// PixlServer Storage System - Transaction Mixin
// Copyright (c) 2016 - 2017 Joseph Huckaby
// Released under the MIT License

var fs = require("fs");
var util = require("util");
var Path = require("path");
var cp = require("child_process");
var os = require("os");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");
var mkdirp = Tools.mkdirp;

// Transaction support is implemented as a mixin to Storage
// Config Keys:
//		transactions: true or false
//		trans_dir: temp dir, only used if non-local fs, defaults to ./transactions
//		trans_auto_recover: auto recover from crashes / fatal errors

// Subclass Storage so we can hoist get(), put(), head() and delete() for use inside transactions

var TransStorageFunctions = {
	
	__construct: function() {
		// class constructor
		this.tempFileCounter = 1;
	},
	
	put: function(key, value, callback) {
		// store key+value pair in transaction
		var self = this;
		key = this.normalizeKey( key );
		
		// get current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) return callback( new Error("The transaction has completed.  This instance can no longer be used.") );
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		// binary keys not part of transaction system
		if (this.isBinaryKey(key)) return this.rawStorage.put(key, value, callback);
		if (!value) return callback( new Error("Value cannot be false.") );
		if (value.fill) return callback( new Error("Buffers not allowed in transactions.") );
		
		this.logDebug(9, "Storing JSON Object in transaction: " + key, this.debugLevel(10) ? value : null);
		value = JSON.stringify( value );
		
		// flag key as written
		trans.keys[key] = 'W';
		
		// store in memory during transaction
		trans.values[key] = {
			mod: Tools.timeNow(true),
			len: Buffer.byteLength(value, 'utf8'),
			data: JSON.parse( value )
		};
		
		setImmediate( function() {
			self.logDebug(9, "Store operation complete (in transaction): " + key);
			callback( null, null );
		} );
	},
	
	head: function(key, callback) {
		// fetch metadata given key: { mod, len }
		var self = this;
		key = this.normalizeKey( key );
		
		// get current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) return callback( new Error("The transaction has completed.  This instance can no longer be used.") );
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		// binary keys not part of transaction system
		if (this.isBinaryKey(key)) return this.rawStorage.head(key, callback);
		
		// if we haven't written key yet, use raw storage
		if (!(key in trans.keys)) return this.rawStorage.head(key, callback);
		
		if (trans.keys[key] == 'W') {
			// we've written the key, so fetch our version
			this.logDebug(9, "Pinging Object from transaction: " + key);
			
			setImmediate( function() {
				self.logDebug(9, "Head complete: " + key);
				var value = trans.values[key];
				callback( null, {
					mod: value.mod,
					len: value.len
				} );
			} );
		}
		else if (trans.keys[key] == 'D') {
			// simulate a deleted record
			// do this in next tick just to be safe (allow I/O to run)
			var err = new Error("Failed to head key: " + key + ": File not found");
			err.code = "NoSuchKey";
			
			setImmediate( function() {
				callback( err, null );
			} );
		}
	},
	
	get: function(key, callback) {
		// fetch value given key
		var self = this;
		key = this.normalizeKey( key );
		
		// get current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) return callback( new Error("The transaction has completed.  This instance can no longer be used.") );
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		// binary keys not part of transaction system
		if (this.isBinaryKey(key)) return this.rawStorage.get(key, callback);
		
		// if we haven't written key yet, use raw storage
		if (!(key in trans.keys)) return this.rawStorage.get(key, callback);
		
		if (trans.keys[key] == 'W') {
			// we've written the key, so fetch our version
			this.logDebug(9, "Fetching Object in transaction: " + key);
			
			setImmediate( function() {
				var data = trans.values[key].data;
				self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? data : null);
				callback( err, Tools.copyHash(data, true) );
			} );
		}
		else if (trans.keys[key] == 'D') {
			// simulate fetching a deleted record
			// do this in next tick just to be safe (allow I/O to run)
			var err = new Error("Failed to fetch key: " + key + ": File not found");
			err.code = "NoSuchKey";
			
			setImmediate( function() {
				callback( err, null );
			} );
		}
	},
	
	delete: function(key, callback) {
		// delete record given key
		var self = this;
		key = this.normalizeKey( key );
		
		// get current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) return callback( new Error("The transaction has completed.  This instance can no longer be used.") );
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		// binary keys not part of transaction system
		if (this.isBinaryKey(key)) return this.rawStorage.delete(key, callback);
		
		// if we haven't touched the key yet, then we need to simulate this using head()
		if (!(key in trans.keys)) {
			this.rawStorage.head(key, function(err, info) {
				if (err) return callback(err);
				
				// flag key as deleted
				trans.keys[key] = 'D';
				
				self.logDebug(9, "Deleting Object from transaction: " + key);
				
				if (callback) callback();
			});
			return;
		}
		
		this.logDebug(9, "Deleting Object from transaction: " + key);
		
		// flag key as deleted
		trans.keys[key] = 'D';
		delete trans.values[key];
		
		setImmediate( function() {
			self.logDebug(9, "Delete complete: " + key);
			if (callback) callback(null, null);
		} );
	},
	
	enqueue: function(task) {
		// enqueue task for execution AFTER commit
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) throw new Error("The transaction has completed.  This instance can no longer be used.");
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		trans.queue.push( task );
	},
	
	abort: function(callback) {
		// abort current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) throw new Error("The transaction has completed.  This instance can no longer be used.");
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		this.rawStorage.abortTransaction( this.currentTransactionPath, callback );
	},
	
	commit: function(callback) {
		// commit current transaction
		var trans = this.transactions[ this.currentTransactionPath ];
		if (!trans) throw new Error("The transaction has completed.  This instance can no longer be used.");
		if (trans.aborting) return callback( new Error("The transaction is being aborted.  This instance can no longer be used.") );
		
		this.rawStorage.commitTransaction( this.currentTransactionPath, callback );
	}
	
};

//
// Transaction Storage Mixin
//

module.exports = Class.create({
	
	transactions: null,
	
	transEarlyStart: function() {
		// early check for unclean shutdown
		var pid_file = this.server.config.get('pid_file');
		if (!pid_file) return true; // need pid file to check
		
		try { fs.statSync( pid_file ); }
		catch (e) { return true; } // no pid file, clean startup
		
		// if 'trans_auto_recover' is set, return normally
		if (this.config.get('trans_auto_recover')) return true;
		
		// if we got here then we found a PID file -- force recovery mode
		if (this.server.config.get('recover')) {
			// user added '--recovery' CLI param, good
			// force debug mode (no daemon fork) and allow startup to continue
			this.server.debug = true;
			this.server.echo = true;
			this.server.logger.set('echo', true);
			this.logDebug(1, "Entering database recovery mode");
			return true;
		}
		else {
			var msg = '';
			msg += "\n";
			msg += this.server.__name + " was shut down uncleanly and needs to run database recovery operations.\n";
			msg += "Please start it in recovery mode by issuing this command:\n\n";
			msg += "\t" + process.argv.join(' ') + " --recover\n";
			msg += "\n";
			process.stdout.write(msg);
			process.exit(1);
		}
	},
	
	initTransactions: function(callback) {
		// initialize transaction system, look for recovery files
		var self = this;
		if (!this.config.get('transactions')) return callback();
		
		// keep in-memory hash of active transactions
		this.transactions = {};
		
		// transaction IDs are sequence numbers starting from 1
		this.nextTransID = 1;
		
		// create temp trans dirs
		this.transDir = 'transactions';
		if (this.config.get('trans_dir')) this.transDir = this.config.get('trans_dir');
		else if (this.engine.baseDir) this.transDir = Path.join( this.engine.baseDir, "_transactions" );
		
		try {
			mkdirp.sync( Path.join(this.transDir, "logs") );
			mkdirp.sync( Path.join(this.transDir, "data") );
		}
		catch (err) {
			var msg = "FATAL ERROR: Transaction directory could not be created: " + this.transDir + "/*: " + err;
			this.logError('startup', msg);
			return callback( new Error(msg) );
		}
		
		// construct special subclass for cloning storage
		this.TransStorage = Class.create( Tools.mergeHashes( TransStorageFunctions, {
			__name: 'Storage',
			__parent: require("./storage.js")
		}) );
		
		// hoist compound functions to use transaction wrappers
		this.transHoistCompounds();
		
		// look for recovery logs
		var log_dir = Path.join(this.transDir, "logs");
		
		fs.readdir(log_dir, function(err, files) {
			if (err) return callback(err);
			
			// if no files found, then good, no recovery necessary, return ASAP
			if (!files || !files.length) {
				if (self.server.config.get('recover')) {
					self.logDebug(1, "Database recovery is complete (no recovery actions were required).");
					// self.logDebug(1, "Resuming normal startup");
					
					// we got here from '--recover' mode, so print message and exit now
					var msg = '';
					msg += "\n";
					msg += "Database recovery is complete.  No actions were required.\n";
					msg += self.server.__name + " can now be started normally.\n";
					msg += "\n";
					process.stdout.write(msg);
					
					var pid_file = self.server.config.get('pid_file');
					if (pid_file) try { fs.unlinkSync( pid_file ); } catch(e) {;}
					
					process.exit(0);
				}
				return callback();
			}
			
			// take over logging for this part
			var orig_log_path = self.logger.path;
			var recovery_log_path = Path.join( Path.dirname(orig_log_path), 'recovery.log' );
			var recovery_trans_count = 0;
			
			self.logDebug(1, "Beginning database recovery, see " + recovery_log_path + " for details");
			self.logger.path = recovery_log_path;
			self.logDebug(1, "Beginning database recovery");
			
			// sort logs by their IDs descending, so we roll back transactions in reverse order
			files.sort( function(a, b) {
				return parseInt(b) - parseInt(a);
			});
			
			// damn, unclean shutdown, iterate over recovery logs
			async.eachSeries( files,
				function(filename, callback) {
					var file = Path.join( log_dir, filename );
					self.logDebug(3, "Processing recovery log: " + file);
					
					fs.open(file, "r", function(err, fh) {
						if (err) {
							self.logError('rollback', "Failed to open recovery log: " + file + ": " + err.message);
							fs.unlink(file, function() { callback(); });
							return;
						}
						
						// read just enough to ensure we get the header
						var chunk = Buffer.alloc(8192);
						fs.read(fh, chunk, 0, 8192, null, function(err, num_bytes, chunk) {
							fs.close(fh, function() {});
							
							if (err) {
								self.logError('rollback', "Failed to read recovery log: " + file + ": " + err.message);
								fs.unlink(file, function() { callback(); });
								return;
							}
							if (!num_bytes) {
								self.logError('rollback', "Failed to read recovery log: " + file + ": 0 bytes read");
								fs.unlink(file, function() { callback(); });
								return;
							}
							
							var data = chunk.slice(0, num_bytes).toString().split("\n", 2)[0];
							
							// parse header (JSON)
							var trans = null;
							try { trans = JSON.parse( data ); }
							catch (err) {
								self.logError('rollback', "Failed to read recovery header: " + file + ": " + err.message);
								fs.unlink(file, function() { callback(); });
								return;
							}
							if (!trans.id || !trans.path || !trans.log || !trans.date || !trans.pid) {
								self.logError('rollback', "Failed to read recovery header: " + file + ": Malformed data");
								fs.unlink(file, function() { callback(); });
								return;
							}
							
							self.logDebug(1, "Rolling back partial transaction: " + trans.path, trans);
							
							// restore transaction info
							self.transactions[ trans.path ] = trans;
							
							// abort (rollback) transaction
							recovery_trans_count++;
							self.abortTransaction( trans.path, callback );
							
						}); // fs.read
					}); // fs.open
				}, // foreach file
				function(err) {
					// all logs complete
					// delete ALL temp data files (these are not used for recovery)
					var data_dir = Path.join(self.transDir, "data");
					
					fs.readdir(data_dir, function(err, files) {
						if (err) return callback(err);
						if (!files) files = [];
						
						async.eachLimit( files, self.concurrency,
							function(filename, callback) {
								var file = Path.join( data_dir, filename );
								fs.unlink( file, function() { callback(); } ); // ignoring error
							},
							function() {
								// recovery complete
								self.logDebug(1, "Database recovery is complete. " + recovery_trans_count + " transactions rolled back.");
								
								// restore original log setup
								self.logger.path = orig_log_path;
								self.logDebug(1, "Database recovery is complete, see " + recovery_log_path + " for details.");
								
								// save info in case app wants to sniff this on startup and notify user
								self.recovery_log = recovery_log_path;
								self.recovery_count = recovery_trans_count;
								
								if (self.server.config.get('recover')) {
									// we got here from '--recover' mode, so print message and exit now
									var msg = '';
									msg += "\n";
									msg += "Database recovery is complete.  Please see " + recovery_log_path + " for full details.\n";
									msg += self.server.__name + " can now be started normally.\n";
									msg += "\n";
									process.stdout.write(msg);
									
									var pid_file = self.server.config.get('pid_file');
									if (pid_file) try { fs.unlinkSync( pid_file ); } catch(e) {;}
									
									process.exit(0);
								}
								else {
									// continue startup
									callback();
								}
							}
						); // eachSeries (data)
					}); // readdir (data)
				} // all logs complete
			); // eachSeries (logs)
		}); // readdir (logs)
	},
	
	transHoistCompounds: function() {
		// hoist all compound storage API calls to use transaction wrappers
		// 1st arg MUST be key, last arg MUST be callback, errs are FATAL (trigger rollback)
		var self = this;
		var api_list = [
			'listCreate', 
			'listPush', 
			'listUnshift', 
			'listPop', 
			'listShift', 
			'listSplice', 
			'listDelete', 
			'listCopy', 
			'listRename', 
			'listEachUpdate',
			'listEachPageUpdate',
			'hashCreate', 
			'hashPut', 
			'hashPutMulti',
			'hashUpdate',
			'hashUpdateMulti', 
			'hashCopy', 
			'hashRename', 
			'hashDeleteMulti', 
			'hashDeleteAll', 
			'hashDelete' 
		];
		
		api_list.forEach( function(name) {
			// replace function with transaction-aware wrapper
			self[name] = function() {
				var self = this;
				var args = Array.prototype.slice.call(arguments);
				
				// if transaction already in progress, tag along
				if (self.currentTransactionPath) {
					return self.TransStorage.prototype[name].apply(self, args);
				}
				
				// 1st arg MUST be key, last arg MUST be callback
				var path = args[0];
				var origCallback = args.pop();
				
				// here we go
				self.beginTransaction(path, function(err, clone) {
					// transaction has begun, now insert our own callback to commit it
					
					var finish = function() {
						var args = Array.prototype.slice.call(arguments);
						var err = args[0];
						if (err) {
							// compound function generated an error
							// emergency abort, rollback
							self.abortTransaction(path, function() {
								// call original callback with error that triggered rollback
								origCallback( err );
							}); // abort
						}
						else {
							// no error, commit transaction
							self.commitTransaction(path, function(err) {
								if (err) {
									// commit failed, trigger automatic rollback
									self.abortTransaction(path, function() {
										// call original callback with commit error
										origCallback( err );
									}); // abort
								} // commit error
								else {
									// success!  call original callback with full args
									origCallback.apply( null, args );
								}
							}); // commit
						} // no error
					}; // finish
					
					// call original function on CLONE (transaction-aware version)
					args.push( finish );
					clone[name].apply(clone, args);
				}); // beginTransaction
			}; // hoisted func
		}); // forEach
	},
	
	begin: function(path, callback) {
		// shortcut for beginTransaction
		this.beginTransaction(path, callback);
	},
	
	beginTransaction: function(path, callback) {
		// begin a new transaction, starting at 'path' and encapsulating everything under it
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		if (!this.transactions) return callback(null, this);
		if (this.currentTransactionPath) return callback(null, this);
		
		this._transLock(path, true, function() {
			// got lock for transaction
			var id = '' + Math.floor(self.nextTransID++);
			var log_file = Path.join( self.transDir, "logs", process.pid + '-' + id + '.log' );
			var trans = { id: id, path: path, log: log_file, date: Tools.timeNow(), pid: process.pid };
			
			self.logDebug(5, "Beginning new transaction on: " + path, trans);
			
			// transaction is ready to begin
			trans.keys = {};
			trans.values = {};
			trans.queue = [];
			self.transactions[path] = trans;
			
			// clone self with currentTransactionPath set
			var clone = new self.TransStorage();
			
			['config', 'server', 'logger', 'cache', 'cacheKeyRegEx', 'listItemsPerPage', 'hashItemsPerPage', 'concurrency', 'cacheKeyRegex', 'engine', 'queue', 'transactions', 'transDir', 'started', 'perf', 'logEventTypes' ].forEach( function(key) {
				clone[key] = self[key];
			});
			
			clone.currentTransactionPath = trans.path;
			clone.rawStorage = self;
			clone.locks = {};
			
			callback(null, clone);
		}); // lock
	},
	
	abortTransaction: function(path, callback) {
		// abort transaction in progress, rollback any actions taken
		var self = this;
		if (!this.transactions) return callback();
		if (this.currentTransactionPath) return callback();
		
		var trans = this.transactions[path];
		if (!trans) return callback( new Error("Unable to find transaction matching path: " + path) );
		
		if (trans.aborting) return callback( new Error("Transaction is already being aborted: " + path) );
		trans.aborting = true;
		
		var num_actions = Tools.numKeys(trans.keys || {});
		this.logError('rollback', "Aborting transaction: " + trans.id, { path: path, actions: num_actions });
		
		// read in file line by line
		// (file may not exist, which is fine, hence 'ignore_not_found')
		Tools.fileEachLine( trans.log, { ignore_not_found: true },
			function(line, callback) {
				var json = null;
				try { json = JSON.parse(line); }
				catch (err) {
					// non-fatal, file may have been partially written
					self.logError('rollback', "Failed to parse JSON in recovery log: " + err, line);
					return callback();
				}
				if (json) {
					if (json.key) {
						// restore or delete record
						if (json.value) {
							self.put( json.key, json.value, function(err) {
								if (err) {
									var msg = "Could not rollback transaction: " + path + ": Failed to restore record: " + json.key + ": " + err.message;
									self.logError('rollback', msg);
									return callback( new Error(msg) ); // this is fatal
								}
								callback();
							} );
						}
						else {
							self.delete( json.key, function(err) {
								if (err && (err.code != "NoSuchKey")) {
									var msg = "Could not rollback transaction: " + path + ": Failed to delete record: " + json.key + ": " + err.message;
									self.logError('rollback', msg);
									return callback( new Error(msg) ); // this is fatal
								}
								callback(); // record already deleted, non-fatal
							} );
						}
					}
					else if (json.id) {
						// must be the file header
						self.logDebug(3, "Transaction rollback metadata", json);
						return callback();
					}
					else {
						// non-fatal, file may have been partially written
						self.logError('rollback', "Unknown JSON record type", json);
						return callback();
					}
				}
			},
			function(err) {
				// check for fatal error
				if (err) {
					// rollback errors are fatal, as the DB cannot continue in a partial state
					self.transFatalError(err);
					return;
				}
				
				// delete transaction log
				self.logDebug(9, "Deleting transaction log: " + trans.log);
				
				fs.unlink( trans.log, function(err) {
					if (err && !err.message.match(/ENOENT/)) {
						self.logError('rollback', "Unable to delete rollback log: " + trans.log + ": " + err);
					}
					
					// complete, unlock and remove transaction from memory
					self.transactions[path].keys = {}; // release memory
					self.transactions[path].values = {}; // release memory
					self.transactions[path].queue = []; // release memory
					delete self.transactions[path];
					
					self.logDebug(3, "Transaction rollback complete: " + trans.id, { path: path });
					
					// unlock at the VERY end, as a new transaction may be waiting on the same path
					self.unlock( 'C|'+path );
					self._transUnlock(path);
					
					callback();
				}); // fs.unlink
			} // done with log
		); // fileEachLine
	},
	
	commitTransaction: function(path, callback) {
		// commit transaction to storage
		var self = this;
		if (!this.transactions) return callback();
		if (this.currentTransactionPath) return callback();
		
		var trans = this.transactions[path];
		if (!trans) return callback( new Error("Unable to find transaction matching path: " + path) );
		
		if (trans.committing) return callback( new Error("Transaction is already being committed: " + path) );
		trans.committing = true;
		
		if (trans.aborting) return callback( new Error("Transaction has already been aborted: " + path) );
		
		var num_actions = Tools.numKeys(trans.keys);
		this.logDebug(5, "Committing transaction: " + trans.id, { path: path, actions: num_actions });
		
		if (!num_actions) {
			// transaction is complete
			this.logDebug(5, "Transaction has no actions, committing instantly");
			
			// transaction is complete
			trans.keys = {}; // release memory
			trans.values = {}; // release memory
			delete this.transactions[path];
			
			this._transUnlock(path);
			if (callback) callback();
			
			// enqueue any pending tasks that got added during the transaction
			if (trans.queue.length) {
				trans.queue.forEach( this.enqueue.bind(this) );
				trans.queue = []; // release memory
			}
			
			return;
		}
		
		// start commit and track perf
		var num_bytes = 0;
		var pf = this.perf.begin('commit');
		
		async.waterfall(
			[
				function(callback) {
					// acquire commit lock
					self.lock( 'C|'+path, true, function() { callback(); } );
				},
				function(callback) { 
					// open transaction log (exclusive append mode)
					fs.open( trans.log, "ax", callback ); 
				},
				function(fh, callback) {
					// store file handle, write file header
					trans.fh = fh;
					var header = Tools.copyHashRemoveKeys(trans, { keys: 1, values: 1, queue: 1, fh: 1, committing: 1 });
					fs.write( fh, JSON.stringify(header) + "\n", callback );
				},
				function(num_bytes, buf, callback) {
					// fetch all affected keys and append records to rollback log
					async.forEachOfLimit( trans.keys, self.concurrency, 
						function(record_state, key, callback) {
							self.get( key, function(err, value) {
								if (err && (err.code != "NoSuchKey")) return callback(err);
								fs.write( trans.fh, JSON.stringify({ key: key, value: value || 0 }) + "\n", callback );
							});
						},
						callback
					); // forEachOfLimit
				},
				function(callback) {
					// flush log contents to disk
					fs.fsync( trans.fh, function(err) {
						if (err) return callback(err);
						
						fs.close( trans.fh, callback );
						delete trans.fh;
					} );
				},
				function(callback) {
					// notify listeners that the commit is starting, and the rollback log is available
					self.emit('commitStart', trans);
					
					// We must fsync the directory as well, as per: http://man7.org/linux/man-pages/man2/fsync.2.html
					// Note: Yes, read-only is the only way: https://www.reddit.com/r/node/comments/4r8k11/how_to_call_fsync_on_a_directory/
					fs.open( Path.dirname(trans.log), "r", function(err, dh) {
						if (err) return callback(); // this may fail on certain OSes, so treat as non-fatal
						
						fs.fsync(dh, function(err) {
							// ignoring error here, as some filesystems may not allow this
							fs.close(dh, callback);
						});
					} );
				},
				function(callback) {
					// we now have a complete, 100% synced rollback log
					// now commit actual changes to storage -- as fast as possible
					async.forEachOfLimit( trans.keys, self.concurrency, 
						function(record_state, key, callback) {
							if (record_state == 'W') {
								// overwrite record with our transaction's state
								var value = trans.values[key];
								num_bytes += value.len;
								self.put( key, value.data, callback );
							}
							else if (record_state == 'D') {
								self.delete(key, function(err) {
									if (err) {
										if (err.code == "NoSuchKey") {
											// no problem - someone may have deleted the record, or it was already deleted to begin with
											self.logDebug(5, "Record already deleted: " + key);
										}
										else {
											// this should not happen
											return callback(err);
										}
									} // err
									callback();
								});
							} // state 'D'
						},
						callback
					); // forEachOfLimit
				}
			],
			function(err) {
				// commit complete
				var elapsed = pf.end();
				
				if (err) {
					var msg = "Failed to commit transaction: " + path + ": " + err.message;
					self.logError('commit', msg, { id: trans.id });
					self.emit('commitEnd', trans, err);
					return callback( new Error(msg) );
				}
				
				self.logDebug(5, "Transaction committed successfully: " + trans.id, { path: path, actions: num_actions });
				self.logTransaction('commit', path, {
					id: trans.id,
					elapsed_ms: elapsed,
					actions: num_actions,
					bytes_written: num_bytes
				});
				
				// transaction is complete
				delete trans.values; // release memory
				delete self.transactions[path];
				
				// enqueue any pending tasks that got added during the transaction
				if (trans.queue.length) {
					trans.queue.forEach( self.enqueue.bind(self) );
					trans.queue = []; // release memory
				}
				
				// engine may need to sync data records separately (i.e. fsync)
				// do this after releasing transaction lock, but hold log delete until after
				if (self.engine.sync) {
					self.enqueue( function(task, callback) {
						self.transPostSync( trans, callback );
					} );
				}
				else {
					// no sync needed for engine, just delete rollback log
					self.logDebug(9, "No sync needed, deleting transaction log: " + trans.log);
					fs.unlink( trans.log, function() {} );
					delete trans.keys; // release memory
				}
				
				self.emit('commitEnd', trans);
				self.unlock( 'C|'+path );
				self._transUnlock(path);
				callback();
			}
		); // waterfall
	},
	
	transPostSync: function(trans, callback) {
		// call sync after commit completes
		var self = this;
		var wrote_keys = Object.keys(trans.keys).filter( function(key) {
			return trans.keys[key] == 'W';
		});
		delete trans.keys; // release memory
		
		async.eachLimit( wrote_keys, self.concurrency,
			function(key, callback) {
				self.engine.sync( key, function() {
					// ignore error here, as key may be deleted
					callback();
				});
			},
			function(err) {
				// finally we can safely delete the transaction log
				self.logDebug(9, "All " + wrote_keys.length + " syncs complete, deleting transaction log: " + trans.log);
				fs.unlink( trans.log, callback );
			}
		); // forEachOfLimit
	},
	
	transFatalError: function(err) {
		// fatal error: scream loudly and shut down immediately
		var self = this;
		this.server.logger.set('sync', true);
		
		this.logError('fatal', "Fatal transaction error: " + err.message);
		
		// log to crash.log as well (in typical log configurations)
		this.server.logger.set( 'component', 'crash' );
		this.server.logger.debug( 1, "Emergency shutdown: " + err.message );
		
		// stop all future storage actions
		this.started = false;
		
		// allow application to hook fatal event and handle shutdown
		if (this.listenerCount('fatal')) {
			this.emit('fatal', err);
		}
		else {
			// just exit immediately
			self.logDebug(1, "Exiting");
			process.exit(1);
		}
	},
	
	_transLock: function(key, wait, callback) {
		// internal transaction lock wrapper
		// uses unique key prefix so won't deadlock with user locks
		this.lock( 'T|'+key, wait, callback );
	},
	
	_transUnlock: function(key) {
		// internal transaction unlock wrapper
		this.unlock( 'T|'+key );
	}
	
});
