// Redis Storage Plugin
// Copyright (c) 2015 - 2024 Joseph Huckaby
// Released under the MIT License

// Requires the 'ioredis' module from npm
// npm install --save ioredis

const Class = require("pixl-class");
const Component = require("pixl-server/component");
const Redis = require('ioredis');
const Tools = require("pixl-tools");
const Cache = require("pixl-cache");

module.exports = Class.create({
	
	__name: 'Redis',
	__parent: Component,
	
	defaultConfig: {
		
		host: 'localhost',
		port: 6379,
		commandTimeout: 5000,
		connectTimeout: 5000,
		username: "",
		password: "",
		
		keyPrefix: "",
		keyTemplate: ""
	},
	
	startup: function(callback) {
		// setup Redis connection
		var self = this;
		this.logDebug(2, "Setting up Redis", this.config.get() );
		this.setup(callback);
	},
	
	setup: function(callback) {
		// setup Redis connection
		var self = this;
		var r_config = this.config.get();
		
		this.keyPrefix = (r_config.keyPrefix || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';
		delete r_config.keyPrefix;
		
		this.keyTemplate = (r_config.keyTemplate || '').replace(/^\//, '').replace(/\/$/, '');
		delete r_config.keyTemplate;
		
		// optional LRU cache
		this.cache = null;
		var cache_opts = r_config.cache;
		if (cache_opts && cache_opts.enabled) {
			this.logDebug(3, "Setting up LRU cache", cache_opts);
			this.cache = new Cache( Tools.copyHashRemoveKeys(cache_opts, { enabled: 1 }) );
			this.cache.on('expire', function(item, reason) {
				self.logDebug(9, "Expiring LRU cache object: " + item.key + " due to: " + reason, {
					key: item.key,
					reason: reason,
					totalCount: self.cache.count,
					totalBytes: self.cache.bytes
				});
			});
		}
		delete r_config.cache;

		if (!r_config.username.length) delete r_config.username;
		if (!r_config.password.length) delete r_config.password;
		
		r_config.lazyConnect = true;
		r_config.reconnectOnError = function(err) { return true; };
		
		this.redis = new Redis(r_config);
		
		this.redis.on('error', function(err) {
			if (!self.storage.started) {
				return callback( new Error("Redis Startup Error: " + (err.message || err)) );
			}
			
			// error after startup?  Just log it I guess
			self.logError('redis', ''+err);
		}); // error
		
		this.redis.connect(function() {
			self.logDebug(8, "Successfully connected to Redis");
			callback();
		});
	},
	
	prepKey: function(key) {
		// prepare key for S3 based on config
		var md5 = Tools.digestHex(key, 'md5');
		
		if (this.keyPrefix) {
			key = this.keyPrefix + key;
		}
		
		if (this.keyTemplate) {
			var idx = 0;
			var temp = this.keyTemplate.replace( /\#/g, function() {
				return md5.substr(idx++, 1);
			} );
			key = Tools.substitute( temp, { key: key, md5: md5 } );
		}
		
		return key;
	},
	
	put: function(key, value, callback) {
		// store key+value in Redis
		var self = this;
		key = this.prepKey(key);
		var is_binary = this.storage.isBinaryKey(key);
		
		if (is_binary) {
			this.logDebug(9, "Storing Redis Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing Redis JSON Object: " + key, this.debugLevel(10) ? value : null);
			value = Buffer.from( JSON.stringify( value ) );
		}
		
		this.redis.set( key, value, function(err) {
			if (err) {
				err.message = "Failed to store object: " + key + ": " + err;
				self.logError('redis', ''+err);
			}
			else self.logDebug(9, "Store complete: " + key);
			
			// possibly cache in LRU
			if (!err && self.cache && !is_binary) {
				self.cache.set( key, value, { date: Tools.timeNow(true) } );
			}

			if (callback) callback(err);
		} );
	},
	
	putStream: function(key, inp, callback) {
		// store key+value in Redis using read stream
		var self = this;
		
		// The Redis API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		var chunks = [];
		inp.on('data', function(chunk) {
			chunks.push( chunk );
		} );
		inp.on('end', function() {
			var buf = Buffer.concat(chunks);
			self.put( key, buf, callback );
		} );
	},
	
	head: function(key, callback) {
		// head redis value given key
		var self = this;
		key = this.prepKey(key);
		
		// The Redis API has no way to head / ping an object.
		// So, we have to do this the RAM-hard way...
		
		// check cache first
		if (this.cache && this.cache.has(key)) {
			var item = this.cache.getMeta(key);

			if (item.value.length == 0) {
				process.nextTick( function() {
					var err = new Error("Failed to head key: " + key + ": Not found");
					err.code = "NoSuchKey";
					callback( err );
				} );
			}
			else {
				process.nextTick( function() {
					self.logDebug(9, "Cached head complete: " + key);
					callback( null, {
						mod: item.date,
						len: item.value.length
					} );
				} );
			}
			return;
		} // cache

		this.redis.getBuffer( key, function(err, data) {
			if (err) {
				// an actual error
				err.message = "Failed to head key: " + key + ": " + err;
				self.logError('redis', ''+err);
				callback(err);
			}
			else if (!data) {
				// record not found
				// always use "NoSuchKey" in error code
				var err = new Error("Failed to head key: " + key + ": Not found");
				err.code = "NoSuchKey";

				if (self.cache && !self.storage.isBinaryKey(key)) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}

				callback( err, null );
			}
			else {
				callback( null, { mod: 1, len: data.length } );
			}
		} );
	},
	
	get: function(key, callback) {
		// fetch Redis value given key
		var self = this;
		key = this.prepKey(key);
		var is_binary = this.storage.isBinaryKey(key);
		
		this.logDebug(9, "Fetching Redis Object: " + key);
		
		// check cache first
		if (this.cache && !is_binary && this.cache.has(key)) {
			var item = this.cache.getMeta(key);

			if (item.value.length == 0) {
				process.nextTick( function() {
					var err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
					callback( err );
				} );
			}
			else {
				process.nextTick( function() {
					var data = null;
					try { data = JSON.parse( item.value.toString() ); }
					catch (err) {
						self.logError('redis', "Failed to parse JSON record: " + key + ": " + err);
						callback( err, null );
						return;
					}
					self.logDebug(9, "Cached JSON fetch complete: " + key, self.debugLevel(10) ? data : null);

					callback( null, data );
				} );
			}
			return;
		} // cache

		this.redis.getBuffer( key, function(err, result) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('redis', ''+err);
				return callback( err, null );
			}
			else if (!result || !result.length) {
				// record not found
				// always use "NoSuchKey" in error code
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				
				if (self.cache && !is_binary) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}
				
				return callback( err, null );
			}
			
			if (is_binary) {
				self.logDebug(9, "Binary fetch complete: " + key, '' + result.length + ' bytes');
			}
			else {
				// possibly cache in LRU
				if (self.cache) {
					self.cache.set( key, result, { date: Tools.timeNow(true) } );
				}
				
				try { result = JSON.parse( result.toString() ); }
				catch (err) {
					self.logError('redis', "Failed to parse JSON record: " + key + ": " + err);
					callback( err, null );
					return;
				}
				self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? result : null);
			}
			
			callback( null, result );
		} ); // redis.getBuffer
	},
	
	getBuffer: function(key, callback) {
		// fetch Redis buffer given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching Redis Object: " + key);
		
		this.redis.getBuffer( key, function(err, result) {
			if (!result) {
				if (err) {
					// an actual error
					err.message = "Failed to fetch key: " + key + ": " + err;
					self.logError('redis', ''+err);
					callback( err, null );
				}
				else {
					// record not found
					// always use "NoSuchKey" in error code
					var err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
					callback( err, null );
				}
			}
			else {
				self.logDebug(9, "Binary fetch complete: " + key, '' + result.length + ' bytes');
				callback( null, result );
			}
		} );
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		
		// The Redis API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.get( key, function(err, buf) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('redis', ''+err);
				return callback(err);
			}
			else if (!buf) {
				// record not found
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback( err, null );
			}
			
			var stream = new BufferStream(buf);
			callback(null, stream, { mod: 1, len: buf.length });
		} );
	},
	
	getStreamRange: function(key, start, end, callback) {
		// get readable stream to record value given key and range
		var self = this;
		
		// The Redis API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.get( key, function(err, buf) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('redis', ''+err);
				return callback(err);
			}
			else if (!buf) {
				// record not found
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback( err, null );
			}
			
			// validate byte range, now that we have the head info
			if (isNaN(start) && !isNaN(end)) {
				start = buf.length - end;
				end = buf.length ? buf.length - 1 : 0;
			} 
			else if (!isNaN(start) && isNaN(end)) {
				end = buf.length ? buf.length - 1 : 0;
			}
			if (isNaN(start) || isNaN(end) || (start < 0) || (start >= buf.length) || (end < start) || (end >= buf.length)) {
				callback( new Error("Invalid byte range (" + start + '-' + end + ") for key: " + key + " (len: " + buf.length + ")"), null );
				return;
			}
			
			var range = buf.slice(start, end + 1);
			var stream = new BufferStream(range);
			callback(null, stream, { mod: 1, len: buf.length });
		} );
	},
	
	delete: function(key, callback) {
		// delete Redis key given key
		var self = this;
		key = this.prepKey(key);
		var is_binary = this.storage.isBinaryKey(key);
		
		this.logDebug(9, "Deleting Redis Object: " + key);
		
		this.redis.del( key, function(err, deleted) {
			if (!err && !deleted) {
				err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";

				if (self.cache && !is_binary) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}
			}
			if (err) {
				self.logError('redis', "Failed to delete object: " + key + ": " + err);
			}
			else {
				self.logDebug(9, "Delete complete: " + key);

				// possibly "delete" from LRU cache as well
				if (self.cache && !is_binary) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}
			}
			
			callback(err);
		} );
	},
	
	commitTransaction: function(trans, callback) {
		// commit all transaction actions using a native Redis MULTI/EXEC transaction
		var self = this;
		var write_keys = [];
		var write_values = [];
		var write_modified = [];
		var delete_keys = [];
		var bad_state = null;
		var multi = this.redis.multi();
		
		this.logDebug(5, "Beginning transaction commit: " + trans.id, {
			path: trans.path,
			actions: Tools.numKeys(trans.keys)
		});
		
		Object.keys(trans.keys).forEach( function(key) {
			var record_state = trans.keys[key];
			var norm_key = self.storage.normalizeKey(key);
			
			if (record_state == 'W') {
				// Collect writes into parallel arrays so we can update the cache later
				// without stringifying and Buffer-wrapping JSON a second time.
				var item = trans.values[key];
				var redis_key = self.prepKey(norm_key);
				var value = Buffer.from( JSON.stringify( item.data ) );
				
				write_keys.push( redis_key );
				write_values.push( value );
				write_modified.push( item.mod );
				
				multi.set( redis_key, value );
			}
			else if (record_state == 'D') {
				// Queue deletes into the same Redis transaction.
				var redis_key = self.prepKey(norm_key);
				delete_keys.push( redis_key );
				
				multi.del( redis_key );
			}
			else {
				bad_state = new Error("Unknown transaction record state: " + record_state + ": " + key);
			}
		});
		
		if (bad_state) return callback(bad_state);
		
		multi.exec( function(err, results) {
			if (err) {
				// With MULTI/EXEC over the network, a top-level exec error may leave
				// the actual Redis outcome unknowable, so treat it as fatal.
				err.fatal = true;
				self.logError('redis', "Transaction commit failed: " + err);
				return callback(err);
			}
			
			// Redis can return per-command errors from EXEC while still applying
			// other commands.  That is a partial commit, so it must be fatal.
			var cmd_err = null;
			if (results) {
				results.forEach( function(item) {
					if (item && item[0] && !cmd_err) cmd_err = item[0];
				});
			}
			if (cmd_err) {
				cmd_err.fatal = true;
				self.logError('redis', "Transaction command failed: " + cmd_err);
				return callback(cmd_err);
			}
			
			// commit succeeded, so now it is safe to update the engine LRU cache
			if (self.cache) {
				write_keys.forEach( function(key, idx) {
					if (!self.storage.isBinaryKey(key)) {
						self.cache.set( key, write_values[idx], { date: write_modified[idx] } );
					}
				});
				
				delete_keys.forEach( function(key) {
					if (!self.storage.isBinaryKey(key)) {
						// store 'empty' stub in cache
						self.cache.set( key, Buffer.alloc(0), { date: 0 } );
					}
				});
			}
			
			self.logDebug(5, "Transaction commit complete: " + trans.id, {
				path: trans.path
			});
			
			callback();
		} );
	},
	
	unitTestCleanup: function(callback) {
		// cleanup all unit test data
		var self = this;
		this.logDebug(3, "Cleaning up Redis unit test database with FLUSHDB");
		
		return this.redis.flushdb( function(err) {
			if (err) {
				self.logError('redis', "Failed to cleanup Redis unit test database: " + err);
				return callback(err);
			}
			
			if (self.cache) self.cache.clear();
			callback();
		} );
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down Redis");
		if (this.redis) {
			this.redis.quit(callback);
			this.redis = null;
		}
		else callback();
	}
	
});

// Modified the following snippet from node-streamifier:
// Copyright (c) 2014 Gabriel Llamas, MIT Licensed

var util = require('util');
var stream = require('stream');

var BufferStream = function (object, options) {
	if (object instanceof Buffer || typeof object === 'string') {
		options = options || {};
		stream.Readable.call(this, {
			highWaterMark: options.highWaterMark,
			encoding: options.encoding
		});
	} else {
		stream.Readable.call(this, { objectMode: true });
	}
	this._object = object;
};

util.inherits(BufferStream, stream.Readable);

BufferStream.prototype._read = function () {
	this.push(this._object);
	this._object = null;
};
