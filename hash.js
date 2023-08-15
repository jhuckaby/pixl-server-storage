// PixlServer Storage System - Hash Mixin
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	hashCreate: function(path, opts, callback) {
		// Create new hash table
		var self = this;
		
		if (!opts) opts = {};
		if (!opts.page_size) opts.page_size = this.hashItemsPerPage;
		opts.length = 0;
		opts.type = 'hash';
		
		this.logDebug(9, "Creating new hash: " + path, opts);
		
		this.get(path, function(err, hash) {
			if (hash) {
				// hash already exists
				self.logDebug(9, "Hash already exists: " + path, hash);
				return callback(null, hash);
			}
			self.put( path, opts, function(err) {
				if (err) return callback(err);
				
				// create first page
				self.put( path + '/data', { type: 'hash_page', length: 0, items: {} }, function(err) {
					if (err) return callback(err);
					else callback(null, opts);
				} ); // put
			} ); // header created
		} ); // get check
	},
	
	_hashLoad: function(path, create_opts, callback) {
		// Internal method, load hash root, possibly create if doesn't exist
		var self = this;
		if (create_opts && (typeof(create_opts) != 'object')) create_opts = {};
		this.logDebug(9, "Loading hash: " + path);
		
		this.get(path, function(err, hash) {
			if (hash) {
				// hash already exists
				callback(null, hash);
			}
			else if (create_opts && err && (err.code == "NoSuchKey")) {
				// create new hash, ONLY if record was not found (and not some other error)
				self.logDebug(9, "Hash not found, creating it: " + path);
				self.hashCreate(path, create_opts, function(err, hash) {
					if (err) callback(err);
					else callback( null, hash );
				} );
			}
			else {
				// no exist and no create, or some other error
				self.logDebug(9, "Hash could not be loaded: " + path + ": " + err);
				callback(err);
			}
		} ); // get
	},
	
	_hashLock: function(key, wait, callback) {
		// internal hash lock wrapper
		// uses unique key prefix so won't deadlock with user locks
		this.lock( '|'+key, wait, callback );
	},
	
	_hashUnlock: function(key) {
		// internal hash unlock wrapper
		this.unlock( '|'+key );
	},
	
	_hashShareLock: function(key, wait, callback) {
		// internal hash shared lock wrapper
		// uses unique key prefix so won't deadlock with user locks
		this.shareLock( 'C|'+key, wait, callback );
	},
	
	_hashShareUnlock: function(key) {
		// internal hash shared unlock wrapper
		this.shareUnlock( 'C|'+key );
	},
	
	hashPut: function(path, hkey, hvalue, create_opts, callback) {
		// store key/value pair into hash table
		var self = this;
		if (!callback && (typeof(create_opts) == 'function')) {
			callback = create_opts;
			create_opts = {};
		}
		if (!path) return callback(new Error("Hash path must be a valid string."));
		if (!hkey) return callback(new Error("Hash key must be a valid string."));
		if (typeof(hvalue) == 'undefined') return callback(new Error("Hash value must not be undefined."));
		
		this.logDebug(9, "Storing hash key: " + path + ": " + hkey, this.debugLevel(10) ? hvalue : null);
		
		// lock hash for this
		this._hashLock(path, true, function() {
			
			// load header
			self._hashLoad(path, create_opts, function(err, hash) {
				if (err) {
					self._hashUnlock(path);
					return callback(err);
				}
				
				var state = {
					path: path,
					data_path: path + '/data',
					hkey: ''+hkey,
					hvalue: hvalue,
					hash: hash,
					index_depth: -1,
					key_digest: Tools.digestHex(hkey, 'md5')
				};
				
				self._hashPutKey(state, function(err) {
					// done
					self._hashUnlock(path);
					return callback(err);
				}); // _hashPutKey
			}); // load
		}); // lock
	},
	
	_hashPutKey: function(state, callback) {
		// internal hash put method, store at one hashing level
		// recurse for deeper indexes
		var self = this;
		
		self.get(state.data_path, function(err, data) {
			if (err) data = { type: 'hash_page', length: 0, items: {} };
			
			if (data.type == 'hash_index') {
				// recurse for deeper level
				state.index_depth++;
				state.data_path += '/' + state.key_digest.substring(state.index_depth, state.index_depth + 1);
				return self._hashPutKey(state, callback);
			}
			else {
				// got page, store at this level
				var new_key = false;
				data.items = Tools.copyHashRemoveProto( data.items );
				
				if (!(state.hkey in data.items)) {
					data.length++;
					state.hash.length++;
					new_key = true;
				}
				
				data.items[state.hkey] = state.hvalue;
				
				var finish = function(err) {
					if (err) return callback(err);
					
					if (data.length > state.hash.page_size) {
						// enqueue page reindex task
						self.logDebug(9, "Hash page has grown beyond max keys, running index split: " + state.data_path, {
							num_keys: data.length,
							page_size: state.hash.page_size
						});
						self._hashSplitIndex(state, callback);
					} // reindex
					else {
						// no reindex needed
						callback();
					}
				}; // finish
				
				// save page and possibly hash header
				self.put(state.data_path, data, function(err) {
					if (err) return callback(err);
					
					if (new_key) self.put(state.path, state.hash, finish);
					else finish();
				}); // put
			} // hash_page
		}); // get
	},
	
	_hashSplitIndex: function(state, callback) {
		// hash split index
		// split hash level into 16 new index buckets
		var self = this;
		state.index_depth++;
		
		this.logDebug(9, "Splitting hash data into new index: " + state.data_path + " (" + state.index_depth + ")");
		
		// load data page which will be converted to a hash index
		self.get(state.data_path, function(err, data) {
			// check for error or if someone stepped on our toes
			if (err) {
				// normal, hash may have been deleted
				self.logError('hash', "Failed to fetch data record for hash split: " + state.data_path + ": " + err);
				return callback();
			}
			if (data.type == 'hash_index') {
				// normal, hash may already have been indexed
				self.logDebug(9, "Data page has been reindexed already, skipping: " + state.data_path, data);
				return callback();
			}
			
			// rehash keys at new index depth
			var pages = {};
			data.items = Tools.copyHashRemoveProto( data.items );
			
			for (var hkey in data.items) {
				var key_digest = Tools.digestHex(hkey, 'md5');
				var ch = key_digest.substring(state.index_depth, state.index_depth + 1);
				
				if (!pages[ch]) pages[ch] = { type: 'hash_page', length: 0, items: {} };
				pages[ch].items[hkey] = data.items[hkey];
				pages[ch].length++;
				
				// Note: In the very rare case where a subpage also overflows,
				// the next hashPut will take care of the nested reindex.
			} // foreach key
			
			// save all pages in parallel, then rewrite data page as an index
			async.forEachOfLimit(pages, self.concurrency, 
				function (page, ch, callback) {
					self.put( state.data_path + '/' + ch, page, callback );
				},
				function(err) {
					if (err) {
						return callback( new Error("Failed to write data records for hash split: " + state.data_path + "/*: " + err.message) );
					}
					
					// final conversion of original data path
					self.put( state.data_path, { type: 'hash_index' }, function(err) {
						if (err) {
							return callback( new Error("Failed to write data record for hash split: " + state.data_path + ": " + err.message) );
						}
						
						self.logDebug(9, "Hash split complete: " + state.data_path);
						callback();
					}); // final put
				} // complete
			); // forEachOf
		}); // get
	},
	
	hashPutMulti: function(path, records, create_opts, callback) {
		// put multiple hash records at once, given object of keys and values
		// need concurrency limit of 1 because hashPut locks
		var self = this;
		if (!callback && (typeof(create_opts) == 'function')) {
			callback = create_opts;
			create_opts = {};
		}
		
		async.eachLimit(Object.keys(records), 1, 
			function(hkey, callback) {
				// iterator for each key
				self.hashPut(path, hkey, records[hkey], create_opts, function(err) {
					callback(err);
				} );
			}, 
			function(err) {
				// all keys stored
				callback(err);
			}
		);
	},
	
	hashGet: function(path, hkey, callback) {
		// fetch key/value pair from hash table
		var self = this;
		var state = {
			path: path,
			data_path: path + '/data',
			hkey: hkey,
			index_depth: -1,
			key_digest: Tools.digestHex(hkey, 'md5')
		};
		this.logDebug(9, "Fetching hash key: " + path + ": " + hkey);
		
		this._hashShareLock(path, true, function() {
			// share locked
			self._hashGetKey(state, function(err, value) {
				// done
				self._hashShareUnlock(path);
				callback(err, value);
			}); // _hashGetKey
		} ); // _hashShareLock
	},
	
	_hashGetKey: function(state, callback) {
		// internal hash get method, fetch at one hashing level
		// recurse for deeper indexes
		var self = this;
		
		self.get(state.data_path, function(err, data) {
			if (err) return callback(err);
			
			if (data.type == 'hash_index') {
				// recurse for deeper level
				state.index_depth++;
				state.data_path += '/' + state.key_digest.substring(state.index_depth, state.index_depth + 1);
				return self._hashGetKey(state, callback);
			}
			else {
				// got page, fetch at this level
				data.items = Tools.copyHashRemoveProto( data.items );
				
				if (!(state.hkey in data.items)) {
					// key not found
					var err = new Error("Failed to fetch hash key: " + state.path + ": " + state.hkey + ": Not found");
					err.code = "NoSuchKey";
					return callback(err);
				}
				
				callback(null, data.items[state.hkey]);
			} // hash_page
		}); // get
	},
	
	hashGetMulti: function(path, hkeys, callback) {
		// fetch multiple hash records at once, given array of keys
		// callback is provided an array of values in matching order to keys
		var self = this;
		var records = Object.create(null);
		
		async.eachLimit(hkeys, this.concurrency, 
			function(hkey, callback) {
				// iterator for each key
				self.hashGet(path, hkey, function(err, value) {
					if (err) return callback(err);
					records[hkey] = value;
					callback();
				} );
			}, 
			function(err) {
				if (err) return callback(err);
				
				// sort records into array of values ordered by keys
				var values = [];
				for (var idx = 0, len = hkeys.length; idx < len; idx++) {
					values.push( records[hkeys[idx]] );
				}
				
				callback(null, values);
			}
		);
	},
	
	hashUpdate: function(path, hkey, updates, callback) {
		// update existing key/value pair in hash table
		var self = this;
		if (!path) return callback(new Error("Hash path must be a valid string."));
		if (!hkey) return callback(new Error("Hash key must be a valid string."));
		if (!Tools.isaHash(updates)) return callback(new Error("Hash updates must be an object."));
		
		this.logDebug(9, "Updating hash key: " + path + ": " + hkey, this.debugLevel(10) ? updates : null);
		
		// lock hash for this
		this._hashLock(path, true, function() {
			
			// load header, do not create new
			self._hashLoad(path, false, function(err, hash) {
				if (err) {
					self._hashUnlock(path);
					return callback(err);
				}
				
				var state = {
					path: path,
					data_path: path + '/data',
					hkey: ''+hkey,
					updates: updates,
					hash: hash,
					index_depth: -1,
					key_digest: Tools.digestHex(hkey, 'md5')
				};
				
				self._hashUpdateKey(state, function(err) {
					// done
					self._hashUnlock(path);
					return callback(err);
				}); // _hashPutKey
			}); // load
		}); // lock
	},
	
	_hashUpdateKey: function(state, callback) {
		// internal hash update method, store at one hashing level
		// recurse for deeper indexes
		var self = this;
		
		self.get(state.data_path, function(err, data) {
			if (err) data = { type: 'hash_page', length: 0, items: {} };
			
			if (data.type == 'hash_index') {
				// recurse for deeper level
				state.index_depth++;
				state.data_path += '/' + state.key_digest.substring(state.index_depth, state.index_depth + 1);
				return self._hashUpdateKey(state, callback);
			}
			else {
				// got page, our key should be at this level
				data.items = Tools.copyHashRemoveProto( data.items );
				
				if (!(state.hkey in data.items)) {
					// key not found
					var err = new Error("Failed to fetch hash key: " + state.path + ": " + state.hkey + ": Not found");
					err.code = "NoSuchKey";
					return callback(err);
				}
				
				var hvalue = data.items[state.hkey];
				
				// apply updates directly to forehead
				for (var key in state.updates) {
					Tools.setPath( hvalue, key, state.updates[key] );
				}
				
				// save page
				self.put(state.data_path, data, callback);
			} // hash_page
		}); // get
	},
	
	hashUpdateMulti: function(path, records, callback) {
		// update multiple hash records at once, given object of keys and values
		// need concurrency limit of 1 because hashUpdate locks
		var self = this;
		
		async.eachLimit(Object.keys(records), 1, 
			function(hkey, callback) {
				// iterator for each key
				self.hashUpdate(path, hkey, records[hkey], function(err) {
					callback(err);
				} );
			}, 
			function(err) {
				// all keys updated
				callback(err);
			}
		);
	},
	
	hashEachPage: function(path, iterator, callback) {
		// call user iterator for each populated hash page, data only
		// iterator will be passed page items hash object
		var self = this;
		
		this._hashShareLock(path, true, function() {
			// share locked
			self._hashEachPage(path + '/data', 
				function(data, callback) {
					if ((data.type == 'hash_page') && (data.length > 0)) {
						data.items = Tools.copyHashRemoveProto( data.items );
						iterator(data.items, callback);
					}
					else callback();
				}, 
				function(err) {
					self._hashShareUnlock(path);
					callback(err);
				}
			); // _hashEachPage
		} ); // _hashShareLock
	},
	
	_hashEachPage: function(data_path, iterator, callback) {
		// internal method for iterating over hash pages
		// invokes interator for both index and data pages
		var self = this;
		
		self.get(data_path, function(err, data) {
			if (err) return callback(); // normal, page may not exist
			data.path = data_path;
			
			iterator(data, function(err) {
				if (err) return callback(err); // abnormal
				
				if (data.type == 'hash_index') {
					// recurse for deeper level
					async.eachSeries( [0,1,2,3,4,5,6,7,8,9,'a','b','c','d','e','f'],
						function(ch, callback) {
							self._hashEachPage( data_path + '/' + ch, iterator, callback );
						},
						callback
					);
				}
				else callback();
			}); // complete
		}); // get
	},
	
	hashGetAll: function(path, callback) {
		// return ALL keys/values as a single, in-memory hash
		var self = this;
		var everything = Object.create(null);
		
		this._hashShareLock(path, true, function() {
			// share locked
			self._hashEachPage( path + '/data',
				function(page, callback) {
					// called for each hash page (index or data)
					if (page.type == 'hash_page') {
						page.items = Tools.copyHashRemoveProto( page.items );
						Tools.mergeHashInto( everything, page.items );
					}
					callback();
				},
				function(err) {
					self._hashShareUnlock(path);
					callback(err, err ? null : everything);
				} // done
			); // _hashEachPage
		} ); // _hashShareLock
	},
	
	hashEach: function(path, iterator, callback) {
		// iterate over hash and invoke function for every key/value
		// iterator function is asynchronous (callback), like async.forEachOfSeries
		var self = this;
		
		this._hashShareLock(path, true, function() {
			// share locked
			self._hashEachPage( path + '/data',
				function(page, callback) {
					// called for each hash page (index or data)
					if (page.type == 'hash_page') {
						page.items = Tools.copyHashRemoveProto( page.items );
						async.forEachOfSeries( page.items,
							function(hvalue, hkey, callback) {
								// swap places of hkey,hvalue in iterator args because I HATE how async does it
								iterator(hkey, hvalue, callback);
							},
							callback
						); // forEachOfSeries
					} // hash_page
					else callback();
				}, // page
				function(err) {
					self._hashShareUnlock(path);
					callback(err);
				}
			); // _hashEachPage
		} ); // _hashShareLock
	},
	
	hashEachSync: function(path, iterator, callback) {
		// iterate over hash and invoke function for every key/value
		// iterator function is synchronous (no callback), like Array.forEach()
		var self = this;
		
		this._hashShareLock(path, true, function() {
			// share locked
			self._hashEachPage( path + '/data',
				function(page, callback) {
					// called for each hash page (index or data)
					if (page.type == 'hash_page') {
						page.items = Tools.copyHashRemoveProto( page.items );
						for (var hkey in page.items) {
							if (iterator( hkey, page.items[hkey] ) === false) {
								// user abort
								return callback( new Error("User Abort") );
							}
						}
					} // hash_page
					callback();
				}, // page
				function(err) {
					self._hashShareUnlock(path);
					callback(err);
				}
			); // _hashEachPage
		} ); // _hashShareLock
	},
	
	hashCopy: function(old_path, new_path, callback) {
		// copy entire hash to new location
		var self = this;
		this.logDebug(9, "Copying hash: " + old_path + " to " + new_path);
		
		this._hashLock( new_path, true, function() {
			// copy header
			self.copy( old_path, new_path, function(err) {
				if (err) {
					self._hashUnlock(new_path);
					return callback(err);
				}
				
				// iterate over each page
				self._hashEachPage( old_path + '/data',
					function(page, callback) {
						// called for each hash page (index or data)
						var new_page_path = page.path.replace( old_path, new_path );
						
						// copy page
						self.copy(page.path, new_page_path, callback);
					}, // page
					function(err) {
						// all pages copied
						self._hashUnlock(new_path);
						callback(err);
					}
				); // _hashEachPage
			} ); // copy header
		}); // lock
	},
	
	hashRename: function(old_path, new_path, callback) {
		// Copy, then delete hash (and all keys)
		var self = this;
		this.logDebug(9, "Renaming hash: " + old_path + " to " + new_path);
		
		this.hashCopy( old_path, new_path, function(err) {
			// copy complete, now delete old hash
			if (err) return callback(err);
			
			self.hashDeleteAll( old_path, true, callback );
		} ); // copied
	},
	
	hashDeleteAll: function(path, entire, callback) {
		// delete entire hash
		var self = this;
		
		// support 2-arg calling convention (no entire)
		if (!callback && (typeof(entire) == 'function')) {
			callback = entire;
			entire = false;
		}
		
		this.logDebug(9, "Deleting hash: " + path);
		
		this._hashLock( path, true, function() {
			// load header
			self._hashLoad(path, false, function(err, hash) {
				if (err) {
					self._hashUnlock(path);
					return callback(err);
				}
				
				// iterate over each page
				self._hashEachPage( path + '/data',
					function(page, callback) {
						// called for each hash page (index or data)
						self.delete(page.path, callback);
					}, // page
					function(err) {
						// all pages deleted
						if (err) {
							self._hashUnlock(path);
							return callback(err);
						}
						
						if (entire) {
							// delete hash header as well
							self.delete( path, function(err) {
								self._hashUnlock(path);
								callback(err);
							} ); // delete
						}
						else {
							// reset hash for future use
							hash.length = 0;
							self.put( path, hash, function(err) {
								self._hashUnlock(path);
								callback(err);
							} ); // put
						}
					} // complete
				); // _hashEachPage
			}); // _hashLoad
		}); // lock
	},
	
	hashDelete: function(path, hkey, entire, callback) {
		// delete single key from hash
		var self = this;
		
		// support 3-arg calling convention (no entire)
		if (!callback && (typeof(entire) == 'function')) {
			callback = entire;
			entire = false;
		}
		
		this.logDebug(9, "Deleting hash key: " + path + ": " + hkey);
		
		// lock hash for this
		this._hashLock(path, true, function() {
			
			// load header
			self._hashLoad(path, false, function(err, hash) {
				if (err) {
					self._hashUnlock(path);
					return callback(err);
				}
				
				var state = {
					path: path,
					data_path: path + '/data',
					hkey: hkey,
					hash: hash,
					index_depth: -1,
					key_digest: Tools.digestHex(hkey, 'md5'),
					entire: entire
				};
				
				self._hashDeleteKey(state, function(err) {
					// done
					self._hashUnlock(path);
					return callback(err);
				}); // _hashDeleteKey
			}); // load
		}); // lock
	},
	
	_hashDeleteKey: function(state, callback) {
		// internal hash delete method, delete from one hashing level
		// recurse for deeper indexes
		var self = this;
		
		self.get(state.data_path, function(err, data) {
			if (err) return callback(err);
			
			if (data.type == 'hash_index') {
				// recurse for deeper level
				state.index_depth++;
				state.data_path += '/' + state.key_digest.substring(state.index_depth, state.index_depth + 1);
				return self._hashDeleteKey(state, callback);
			}
			else {
				// got page, delete from this level
				data.items = Tools.copyHashRemoveProto( data.items );
				
				if (!(state.hkey in data.items)) {
					var err = new Error("Failed to delete hash key: " + state.path + ": " + state.hkey + ": Not found");
					err.code = 'NoSuchKey';
					self.logError('hash', err.message);
					return callback(err);
				}
				
				data.length--;
				state.hash.length--;
				
				delete data.items[state.hkey];
				
				// check for delete entire on empty
				if (!state.hash.length && state.entire) {
					self.delete(state.data_path, function(err) {
						if (err) return callback(err);
						self.delete(state.path, callback);
					}); // put
					return;
				}
				
				// save page and hash header
				self.put(state.data_path, data, function(err) {
					if (err) return callback(err);
					
					self.put(state.path, state.hash, function(err) {
						if (err) return callback(err);
						
						// index unsplit time?
						if (!data.length && (state.index_depth > -1)) {
							// index unsplit task
							self.logDebug(9, "Hash page has no more keys, running unsplit check: " + state.data_path);
							self._hashUnsplitIndexCheck(state, callback);
						} // unsplit
						else {
							// no unsplit check needed
							callback();
						}
						
					}); // put
				}); // put
			} // hash_page
		}); // get
	},
	
	_hashUnsplitIndexCheck: function(state, callback) {
		// unsplit hash index
		// check if all sub-pages are empty, and if so, delete all and convert index back into page
		var self = this;
		var data_path = state.data_path.replace(/\/\w+$/, '');
		var found_keys = false;
		var sub_pages = [];
		
		this.logDebug(9, "Checking all hash index sub-pages for unsplit: " + data_path + "/*");
		
		// make sure page is still an index
		self.get(data_path, function(err, data) {
			if (err) {
				self.logDebug(9, "Hash page could not be loaded, aborting unsplit: " + data_path);
				return callback();
			}
			
			if (data.type != 'hash_index') {
				self.logDebug(9, "Hash page is no longer an index, aborting unsplit: " + data_path);
				return callback();
			}
			
			// test each sub-page, counting keys
			// abort on first key (i.e. no need to load all pages in that case)
			async.eachLimit( [0,1,2,3,4,5,6,7,8,9,'a','b','c','d','e','f'], self.concurrency,
				function(ch, callback) {
					self.get( data_path + '/' + ch, function(err, data) {
						if (data) sub_pages.push( ch );
						if (data && ((data.type != 'hash_page') || data.length)) {
							self.logDebug(9, "Index page still has keys: " + data_path + '/' + ch);
							found_keys = true;
							callback( new Error("ABORT") );
						}
						else callback();
					} );
				},
				function(err) {
					// scanned all pages
					if (found_keys || !sub_pages.length) {
						// nothing to be done
						self.logDebug(9, "Nothing to do, aborting unsplit: " + data_path);
						return callback();
					}
					
					self.logDebug(9, "Proceeding with unsplit: " + data_path);
					
					// proceed with unsplit
					async.eachLimit( sub_pages, self.concurrency,
						function(ch, callback) {
							self.delete( data_path + '/' + ch, callback );
						},
						function(err) {
							// all pages deleted, now rewrite index
							if (err) {
								// this should never happen, but we must continue the op.
								// we cannot leave the index in a partially unsplit state.
								self.logError('hash', "Failed to delete index sub-pages: " + data_path + "/*: " + err);
							}
							
							self.put( data_path, { type: 'hash_page', length: 0, items: {} }, function(err) {
								// all done
								if (err) {
									self.logError('hash', "Failed to put index page: " + data_path + ": " + err);
								}
								else {
									self.logDebug(9, "Unsplit operation complete: " + data_path);
								}
								callback();
							} ); // put
						} // pages deleted
					); // eachLimit
				} // key check
			); // eachLimit
		} ); // load
	},
	
	hashDeleteMulti: function(path, hkeys, callback) {
		// delete multiple hash records at once, given array of keys
		// need concurrency limit of 1 because hashDelete locks
		var self = this;
		
		async.eachLimit(hkeys, 1, 
			function(hkey, callback) {
				// iterator for each key
				self.hashDelete(path, hkey, function(err) {
					callback(err);
				} );
			}, 
			function(err) {
				// all keys deleted
				callback(err);
			}
		);
	},
	
	hashGetInfo: function(path, callback) {
		// Return info about hash (number of items, etc.)
		this._hashLoad( path, false, callback );
	}
	
});
