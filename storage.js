// PixlServer Storage System
// Copyright (c) 2015 - 2018 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var unidecode = require('unidecode');

var Class = require("pixl-class");
var Tools = require("pixl-tools");
var Perf = require("pixl-perf");
var Component = require("pixl-server/component");
var List = require("./list.js");
var Hash = require("./hash.js");
var Indexer = require("./indexer.js");
var Transaction = require("./transaction.js");

module.exports = Class.create({
	
	__name: 'Storage',
	__parent: Component,
	__mixins: [ List, Hash, Indexer, Transaction ],
	
	version: require('./package.json').version,
	
	defaultConfig: {
		list_page_size: 50,
		hash_page_size: 50,
		concurrency: 1,
		maintenance: 0,
		log_event_types: { 
			all:0, get:0, put:0, head:0, delete:0, expire_set:0, perf_sec:0, perf_min:0,
			commit:0, index:0, unindex:0, search:0, sort:0, maint:1 
		},
		max_recent_events: 0,
		cache_key_match: '',
		expiration_updates: false,
		lower_case_keys: true,
		queue_timeout: 30000
	},
	
	locks: null,
	cache: null,
	cacheKeyRegex: null,
	started: false,
	customRecordTypes: null,
	
	earlyStart: function() {
		// check for early transaction recovery
		if (!this.config.get('transactions')) return true;
		
		// transactions are enabled
		return this.transEarlyStart();
	},
	
	startup: function(callback) {
		// setup storage plugin
		var self = this;
		this.logDebug(5, "Setting up storage system v" + this.version);
		
		// advisory locking system (in RAM, single process only)
		this.locks = {};
		
		// ram cache for certain keys, configurable
		this.cache = {};
		this.cacheKeyRegEx = null;
		
		// cache some config values, and listen for config refresh
		this.prepConfig();
		this.config.on('reload', this.prepConfig.bind(this) );
		
		// dynamically load storage engine based on config
		var StorageEngine = require(
			this.config.get('engine_path') || 
			("./engines/" + this.config.get('engine') + ".js")
		);
		this.engine = new StorageEngine();
		this.engine.storage = this;
		this.engine.init( this.server, this.config.getSub( this.config.get('engine') ) );
		
		// queue for setting expirations and custom engine ops
		this.queue = async.queue( this.dequeue.bind(this), this.concurrency );
		
		// setup perf tracking system
		this.perf = new Perf();
		this.perf.minMax = true;
		
		this.minutePerf = new Perf();
		this.minutePerf.minMax = true;
		
		this.lastSecondMetrics = {};
		this.lastMinuteMetrics = {};
		this.recentEvents = {};
		
		// allow others to register custom record types for maint
		this.customRecordTypes = {};
		
		// bind to server tick, so we can aggregate perf metrics
		this.server.on('tick', this.tick.bind(this));
		this.server.on('minute', this.tickMinute.bind(this));
		
		// setup daily maintenance, if configured
		if (this.config.get('maintenance')) {
			// e.g. "day", "04:00", etc.
			this.server.on(this.config.get('maintenance'), function() {
				self.runMaintenance();
			});
		}
		
		// allow engine to startup as well
		this.engine.startup( function(err) {
			if (err) return callback(err);
			
			// set started flag, as transactions may need to recover from a crash
			self.started = true;
			
			// finally, init transaction system
			self.initTransactions( function(err) {
				
				// all done
				callback(err);
				
			} ); // initTransactions
		} ); // engine.startup
	},
	
	prepConfig: function() {
		// save some config values
		this.listItemsPerPage = this.config.get('list_page_size');
		this.hashItemsPerPage = this.config.get('hash_page_size');
		this.concurrency = this.config.get('concurrency');
		this.logEventTypes = this.config.get('log_event_types');
		this.maxRecentEvents = this.config.get('max_recent_events');
		this.expHash = this.config.get('expiration_updates');
		this.lowerKeys = this.config.get('lower_case_keys');
		this.queueTimeout = this.config.get('queue_timeout');
		
		this.cacheKeyRegex = null;
		if (this.config.get('cache_key_match')) {
			this.cacheKeyRegex = new RegExp( this.config.get('cache_key_match') );
		}
	},
	
	normalizeKey: function(key) {
		// downconvert unicode, lower-case, alphanum-dash-dot-slash only, strip leading and trailing slashes
		key = '' + key;
		if (this.lowerKeys) key = key.toLowerCase();
		return unidecode(key).replace(/[^\w\-\.\/]+/g, '').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
	},
	
	isBinaryKey: function(key) {
		// binary keys have a built-in file extension, JSON keys do not
		return !!key.match(/\.\w+$/);
	},
	
	addRecordType: function(type, handlers) {
		// add custom record type handler (for maint)
		// handlers: { delete: function }
		this.customRecordTypes[type] = handlers;
	},
	
	put: function(key, value, callback) {
		// store key+value pair
		var self = this;
		
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		key = this.normalizeKey( key );
		
		// sanity checks
		if (!value) return callback( new Error("Record value cannot be false.") );
		
		var isBuffer = !!value.fill;
		if (isBuffer && !this.isBinaryKey(key)) {
			return callback( new Error("Buffer values are only allowed with keys containing file extensions, e.g. " + key + ".bin") );
		}
		else if (!isBuffer && this.isBinaryKey(key)) {
			return callback( new Error("You must pass a Buffer object as the value when using keys containing file extensions.") );
		}
		
		// ram cache
		if (this.cacheKeyRegex && key.match(this.cacheKeyRegex)) {
			this.cache[key] = value;
		}
		
		// invoke engine and track perf
		var pf = this.perf.begin('put');
		
		this.engine.put( key, value, function(err) {
			// put complete
			var elapsed = pf.end();
			
			if (!err) self.logTransaction('put', key, {
				elapsed_ms: elapsed
			});
			
			callback(err);
			if (!err) self.emit('put', key, value);
		} );
	},
	
	putStream: function(key, stream, callback) {
		// store key+stream
		var self = this;
		
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		key = this.normalizeKey( key );
		
		if (!this.isBinaryKey(key)) {
			return callback( new Error("Stream values are only allowed with keys containing file extensions, e.g. " + key + ".bin") );
		}
		
		// sanity checks
		if (!stream || !stream.pipe) return callback( new Error("Not a valid stream.") );
		
		// invoke engine and track perf
		var pf = this.perf.begin('put');
		
		this.engine.putStream( key, stream, function(err) {
			// put complete
			var elapsed = pf.end();
			
			if (!err) self.logTransaction('put', key, {
				elapsed_ms: elapsed
			});
			
			callback(err);
			if (!err) self.emit('putStream', key);
		} );
	},
	
	putStreamCustom: function(key, stream, opts, callback) {
		// store key+stream with engine-specific opts
		var self = this;
		
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		key = this.normalizeKey( key );
		
		if (!this.isBinaryKey(key)) {
			return callback( new Error("Stream values are only allowed with keys containing file extensions, e.g. " + key + ".bin") );
		}
		
		// sanity checks
		if (!stream || !stream.pipe) return callback( new Error("Not a valid stream.") );
		
		// invoke engine and track perf
		var pf = this.perf.begin('put');
		
		this.engine.putStreamCustom( key, stream, opts, function(err) {
			// put complete
			var elapsed = pf.end();
			
			if (!err) self.logTransaction('put', key, {
				elapsed_ms: elapsed
			});
			
			callback(err);
			if (!err) self.emit('putStream', key);
		} );
	},
	
	putMulti: function(records, callback) {
		// put multiple records at once, given object of keys and values
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		// if engine provides its own putMulti, call that directly
		if (("putMulti" in this.engine) && !this.currentTransactionPath) {
			return this.engine.putMulti(records, callback);
		}
		
		async.eachLimit(Object.keys(records), this.concurrency, 
			function(key, callback) {
				// iterator for each key
				self.put(key, records[key], function(err) {
					callback(err);
				} );
			}, 
			function(err) {
				// all keys stored
				callback(err);
			}
		);
	},
	
	head: function(key, callback) {
		// fetch metadata given key: { mod, len }
		var self = this;
		
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		key = this.normalizeKey( key );
		
		// invoke engine and track perf
		var pf = this.perf.begin('head');
		
		this.engine.head( key, function(err, data) {
			// head complete
			var elapsed = pf.end();
			
			if (!err) self.logTransaction('head', key, {
				elapsed_ms: elapsed
			});
			
			callback(err, data);
			if (!err) self.emit('head', key, data);
		} );
	},
	
	headMulti: function(keys, callback) {
		// head multiple records at once, given array of keys
		// callback is provided an array of values in matching order to keys
		var self = this;
		var records = {};
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		// if engine provides its own headMulti, call that directly
		if (("headMulti" in this.engine) && !this.currentTransactionPath) {
			return this.engine.headMulti(keys, callback);
		}
		
		async.eachLimit(keys, this.concurrency, 
			function(key, callback) {
				// iterator for each key
				self.head(key, function(err, data) {
					if (err) callback(err);
					records[key] = data;
					callback();
				} );
			}, 
			function(err) {
				if (err) return callback(err);
				
				// sort records into array of values ordered by keys
				var values = [];
				for (var idx = 0, len = keys.length; idx < len; idx++) {
					values.push( records[keys[idx]] );
				}
				
				callback(null, values);
			}
		);
	},
	
	get: function(key, callback) {
		// fetch value given key
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		key = this.normalizeKey( key );
		var cacheable = !!(this.cacheKeyRegex && key.match(this.cacheKeyRegex));
		
		// ram cache
		if (cacheable && (key in this.cache)) {
			return process.nextTick( callback, null, this.cache[key] );
		}
		
		// invoke engine and track perf
		var pf = this.perf.begin('get');
		
		this.engine.get( key, function(err, value, info) {
			// get complete
			var elapsed = pf.end();
			
			if (err) return callback(err);
			
			// ram cache
			if (cacheable) {
				self.cache[key] = value;
			}
			
			self.logTransaction('get', key, {
				elapsed_ms: elapsed
			});
			
			callback(null, value, info);
			if (!err) self.emit('get', key, value, info);
		} );
	},
	
	getBuffer: function(key, callback) {
		// fetch buffer given key
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		key = this.normalizeKey( key );
		
		// invoke engine and track perf
		var pf = this.perf.begin('get');
		
		this.engine.getBuffer( key, function(err, value, info) {
			// get complete
			var elapsed = pf.end();
			if (err) return callback(err);
			
			self.logTransaction('get', key, {
				elapsed_ms: elapsed
			});
			
			callback(null, value, info);
			if (!err) self.emit('get', key, value, info);
		} );
	},
	
	getStream: function(key, callback) {
		// fetch value via stream pipe
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		key = this.normalizeKey( key );
		
		if (!this.isBinaryKey(key)) {
			return callback( new Error("Stream values are only allowed with keys containing file extensions, e.g. " + key + ".bin") );
		}
		
		this.engine.getStream( key, callback );
	},
	
	getStreamRange: function(key, start, end, callback) {
		// fetch value via stream pipe and range
		// start and end are both inclusive
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		key = this.normalizeKey( key );
		
		if (!this.isBinaryKey(key)) {
			return callback( new Error("Stream values are only allowed with keys containing file extensions, e.g. " + key + ".bin") );
		}
		
		this.engine.getStreamRange( key, start, end, callback );
	},
	
	getMulti: function(keys, callback) {
		// fetch multiple records at once, given array of keys
		// callback is provided an array of values in matching order to keys
		var self = this;
		var records = {};
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		// if engine provides its own getMulti, call that directly
		if (("getMulti" in this.engine) && !this.currentTransactionPath) {
			return this.engine.getMulti(keys, callback);
		}
		
		async.eachLimit(keys, this.concurrency, 
			function(key, callback) {
				// iterator for each key
				self.get(key, function(err, data) {
					if (err) return callback(err);
					records[key] = data;
					callback();
				} );
			}, 
			function(err) {
				if (err) return callback(err);
				
				// sort records into array of values ordered by keys
				var values = [];
				for (var idx = 0, len = keys.length; idx < len; idx++) {
					values.push( records[keys[idx]] );
				}
				
				callback(null, values);
			}
		);
	},
	
	delete: function(key, callback) {
		// delete record given key
		var self = this;
		
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		key = this.normalizeKey( key );
		
		// ram cache
		if (this.cacheKeyRegex && key.match(this.cacheKeyRegex) && (key in this.cache)) {
			delete this.cache[key];
		}
		
		// invoke engine and track perf
		var pf = this.perf.begin('delete');
		
		this.engine.delete( key, function(err) {
			// delete complete
			var elapsed = pf.end();
			
			if (!err) self.logTransaction('delete', key, {
				elapsed_ms: elapsed
			});
			
			callback(err);
			if (!err) self.emit('delete', key);
		} );
	},
	
	deleteMulti: function(keys, callback) {
		// delete multiple records at once, given array of keys
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		// if engine provides its own deleteMulti, call that directly
		if (("deleteMulti" in this.engine) && !this.currentTransactionPath) {
			return this.engine.deleteMulti(keys, callback);
		}
		
		async.eachLimit(keys, this.concurrency, 
			function(key, callback) {
				// iterator for each key
				self.delete(key, function(err) {
					callback(err);
				} );
			}, 
			function(err) {
				// all keys deleted
				callback(err);
			}
		);
	},
	
	copy: function(old_key, new_key, callback) {
		// copy record to new key
		var self = this;
		this.logDebug(9, "Copying record: " + old_key + " to " + new_key);
		
		// load old key
		this.get(old_key, function(err, data) {
			if (err) return callback(err, null);
			
			// save new key
			self.put(new_key, data, callback);
		} );
	},
	
	rename: function(old_key, new_key, callback) {
		// rename record (copy + delete old)
		var self = this;
		this.logDebug(9, "Renaming record: " + old_key + " to " + new_key);
		
		this.copy( old_key, new_key, function(err, data) {
			// copied, now delete old
			self.delete( old_key, callback );
		} );
	},
	
	expire: function(key, expiration, force) {
		// set expiration date on key, normalize to midnight
		var dargs = Tools.getDateArgs(
			Tools.normalizeTime( expiration, { hour:0, min:0, sec:0 } ) 
		);
		
		var dnow = Tools.getDateArgs( new Date() );
		if (!force && ((dargs.epoch <= dnow.epoch) || (dargs.yyyy_mm_dd == dnow.yyyy_mm_dd))) {
			// date is in past, move to tomorrow, to avoid race condition with maintenance()
			// this trick guarantees tomorrow midnight regardless of daylight savings time
			dargs = Tools.getDateArgs( Tools.normalizeTime(
				Tools.normalizeTime( dnow.epoch, { hour:12, min:0, sec:0 } ) + 86400,
				{ hour:0, min:0, sec:0 } )
			);
		}
		
		this.logDebug(9, "Setting expiration on: " + key + " to " + dargs.yyyy_mm_dd);
		
		this.enqueue({
			action: 'expire_set',
			key: key,
			expiration: dargs.epoch
		});
		
		this.emit('expire', key, dargs.epoch);
	},
	
	enqueue: function(task) {
		// enqueue task for execution soon
		if (!this.started) throw new Error("Storage has not completed startup.");
		
		if (typeof(task) == 'function') {
			var func = task;
			task = { action: 'custom', handler: func };
		}
		task._id = Tools.generateShortID();
		this.logDebug(9, "Enqueuing async task: " + task._id + ": " + (task.label || task.action), 
			this.debugLevel(10) ? task : null
		);
		this.queue.push( task );
	},
	
	dequeue: function(task, callback) {
		// run task and fire callback
		var self = this;
		this.logDebug(9, "Running async task: " + task._id + ": " + (task.label || task.action), 
			this.debugLevel(10) ? task : null
		);
		
		// optional timeout for queue item execution
		var timer = this.queueTimeout ? setTimeout( function() {
			self.logError('queue', "Async task timed out: " + task._id + ": " + (task.label || task.action), { ms: self.queueTimeout });
			if (callback) callback();
			callback = null;
			timer = null;
		}, this.queueTimeout ) : null;
		
		switch (task.action) {
			case 'expire_set':
				// set expiration on record
				var dargs = Tools.getDateArgs( task.expiration );
				var cleanup_list_path = '_cleanup/' + dargs.yyyy + '/' + dargs.mm + '/' + dargs.dd;
				var cleanup_hash_path = '_cleanup/expires';
				
				this.listPush( cleanup_list_path, { key: task.key }, { page_size: 1000 }, function(err, data) {
					// should never fail, but who knows
					if (err) self.logError('cleanup', "Failed to push cleanup list: " + cleanup_list_path + ": " + err);
					
					if (self.expHash) {
						self.hashPut( cleanup_hash_path, task.key, { expires: task.expiration }, { page_size: 1000 }, function(err) {
							// should never fail, but who knows
							if (err) self.logError('cleanup', "Failed to put cleanup hash: " + cleanup_hash_path + ": " + err);
							
							self.logTransaction('expire_set', task.key, {
								epoch: dargs.epoch,
								yyyy_mm_dd: dargs.yyyy_mm_dd,
								list_path: cleanup_list_path
							});
							
							if (timer) clearTimeout(timer);
							timer = null;
							
							if (callback) callback();
							callback = null;
						} ); // hashPut
					} // expHash
					else {
						self.logTransaction('expire_set', task.key, {
							epoch: dargs.epoch,
							yyyy_mm_dd: dargs.yyyy_mm_dd,
							list_path: cleanup_list_path
						});
						
						if (timer) clearTimeout(timer);
						timer = null;
						
						if (callback) callback();
						callback = null;
					}
				} ); // listPush
			break; // expire_set
			
			case 'custom':
				// custom handler
				task.handler( task, function(err) {
					if (err) self.logError('storage', "Failed to dequeue custom task: " + err);
					
					if (timer) clearTimeout(timer);
					timer = null;
					
					if (callback) callback();
					callback = null;
				} );
			break; // custom
		} // switch action
	},
	
	runMaintenance: function(date, callback) {
		// run daily maintenance (delete expired keys)
		var self = this;
		var dargs = Tools.getDateArgs( date || (new Date()) );
		var cleanup_list_path = '_cleanup/' + dargs.yyyy + '/' + dargs.mm + '/' + dargs.dd;
		var cleanup_hash_path = '_cleanup/expires';
		var stats = {
			time_start: Tools.timeNow(),
			num_deleted: 0,
			num_skipped: 0,
			num_errors: 0
		};
		
		this.logDebug(3, "Running daily maintenance", cleanup_list_path);
		
		var deleteExpiredRecord = function(key, callback) {
			// delete single expired record of any type
			
			var finishDelete = function(err) {
				// log errors here (some records may already be deleted, which is fine)
				if (err) stats.num_errors++;
				
				// also delete metadata (expires epoch)
				if (self.expHash) {
					self.hashDelete( cleanup_hash_path, key, function(herr) { 
						if (!err) stats.num_deleted++;
						callback(); 
					} );
				}
				else {
					callback();
				}
			};
			
			if (self.isBinaryKey(key)) {
				// straight up delete for binary records
				self.delete( key, finishDelete );
			}
			else {
				// get JSON record to determine type
				self.get( key, function(err, data) {
					if (!data) data = {};
					if (data.type && (data.type == 'list')) {
						self.listDelete( key, true, finishDelete );
					}
					else if (data.type && (data.type == 'hash')) {
						self.hashDeleteAll( key, true, finishDelete );
					}
					else if (data.type && self.customRecordTypes[data.type] && self.customRecordTypes[data.type].delete) {
						self.logDebug(6, "Invoking custom record delete handler for type: " + data.type + ": " + key);
						var func = self.customRecordTypes[data.type].delete;
						func( key, data, finishDelete );
					}
					else {
						self.delete( key, finishDelete );
					}
				} ); // get
			}
		}; // deleteExpiredRecord
		
		var doEngineMaint = function() {
			// allow engine to run maint as well
			self.engine.runMaintenance( function() {
				stats.elapsed_sec = Tools.timeNow() - stats.time_start;
				self.logDebug(3, "Daily maintenance complete");
				self.logTransaction('maint', cleanup_list_path, stats);
				if (callback) callback();
			} );
		}; // finish
		
		this.listEach( cleanup_list_path, 
			function(item, item_idx, callback) {
				// delete item if still expired
				var key = item.key;
				
				// see if expiration date is still overdue
				if (self.expHash) {
					self.hashGet( cleanup_hash_path, key, function(err, data) {
						if (data && data.expires) {
							var eargs = Tools.getDateArgs( data.expires );
							if ((eargs.epoch <= dargs.epoch) || (eargs.yyyy_mm_dd == dargs.yyyy_mm_dd)) {
								// still expired, kill it
								deleteExpiredRecord(key, callback);
							}
							else {
								// oops, expiration changed, skip
								stats.num_skipped++;
								self.logDebug(9, "Expiration on record " + key + " has changed to " + eargs.yyyy_mm_dd + ", skipping delete");
								callback();
							}
						}
						else {
							// no expiration date, just delete it
							deleteExpiredRecord(key, callback);
						}
					} ); // hashGet
				} // expHash
				else {
					deleteExpiredRecord(key, callback);
				}
			},
			function(err) {
				// list iteration complete
				if (err) {
					self.logDebug(10, "Failed to load list, skipping maintenance (probably harmless)", cleanup_list_path);
					doEngineMaint();
				}
				else {
					// no error, delete list
					self.listDelete( cleanup_list_path, true, function(err) {
						if (err) {
							self.logError('maint', "Failed to delete cleanup list: " + cleanup_list_path + ": " + err);
						}
						doEngineMaint();
					} ); // listDelete
				} // succes
			} // list complete
		); // listEach
	},
	
	lock: function(key, wait, callback) {
		// lock key in exclusive mode, possibly wait until acquired
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		if (key.match(/^(\w*\|+)(.+)$/)) key = RegExp.$1 + this.normalizeKey(RegExp.$2);
		else key = this.normalizeKey(key);
		
		this.logDebug(9, "Requesting lock: " + key);
		
		if (this.locks[key]) {
			var lock = this.locks[key];
			if (wait) {
				lock.clients.push(callback);
				this.logDebug(9, "Key is already locked: " + key + ", waiting for unlock (" + lock.clients.length + " clients waiting)");
			}
			else {
				this.logDebug(9, "Key is already locked: " + key);
				callback( new Error("Key is locked"), lock );
			}
		}
		else {
			this.logDebug(9, "Locked key: " + key);
			var lock = { type: 'ex', clients: [] };
			this.locks[key] = lock;
			callback(null, lock);
		}
	},
	
	unlock: function(key) {
		// release lock on key
		if (!this.started) throw new Error("Storage has not completed startup.");
		
		if (key.match(/^(\w*\|+)(.+)$/)) key = RegExp.$1 + this.normalizeKey(RegExp.$2);
		else key = this.normalizeKey(key);
		
		if (this.locks[key]) {
			var lock = this.locks[key];
			if (lock.type != 'ex') {
				this.logError('lock', "Lock is incorrect type (expected exclusive): " + key);
				return;
			}
			
			this.logDebug(9, "Unlocking key: " + key + " (" + lock.clients.length + " clients waiting)");
			var callback = lock.clients.shift();
			if (callback) {
				this.logDebug(9, "Locking key: " + key);
				callback(null, lock);
			}
			else delete this.locks[key];
		}
	},
	
	shareLock: function(key, wait, callback) {
		// lock key in shared (read-only) mode, possibly wait until acquired
		var self = this;
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		if (key.match(/^(\w*\|+)(.+)$/)) key = RegExp.$1 + this.normalizeKey(RegExp.$2);
		else key = this.normalizeKey(key);
		
		this.logDebug(9, "Requesting shared lock: " + key);
		
		if (this.locks[key]) {
			var lock = this.locks[key];
			if ((lock.type == 'sh') && !lock.clients.length) {
				// lock is already shared and no exclusive clients are waiting, so join the party
				lock.readers++;
				this.logDebug(9, "Joined shared lock: " + key, { readers: lock.readers });
				callback(null, lock);
			}
			else {
				// exclusive lock (or shared lock with exclusive clients waiting), so we must wait
				if (!wait) return callback( new Error("Key is locked"), lock );
				
				var func = function(err, lock) {
					if (err) return callback(err);
					
					// acquired lock, convert to shared
					if (lock.type == 'ex') {
						self.logDebug(9, "Locked key in shared mode: " + key);
						lock.type = 'sh';
						lock.readers = 1;
						callback(null, lock);
						
						// look for more pending shared readers
						while (lock.clients[0] && lock.clients[0].__pixl_share_client) {
							var client = lock.clients.shift();
							lock.readers++;
							self.logDebug(9, "Joined shared lock: " + key, { readers: lock.readers });
							client(null, lock);
						}
					}
					else {
						// lock already shared, and we've been joined to it
						callback(null, lock);
					}
				}; // got lock
				
				// add special flag so we know client wants to be shared
				func.__pixl_share_client = 1;
				
				// wait for exclusive lock (which we will convert to shared)
				this.lock(key, true, func);
			}
		}
		else {
			this.logDebug(9, "Locked key in shared mode: " + key);
			var lock = { type: 'sh', clients: [], readers: 1 };
			this.locks[key] = lock;
			callback(null, lock);
		}
	},
	
	shareUnlock: function(key) {
		// release lock on shared key
		if (!this.started) throw new Error("Storage has not completed startup.");
		
		if (key.match(/^(\w*\|+)(.+)$/)) key = RegExp.$1 + this.normalizeKey(RegExp.$2);
		else key = this.normalizeKey(key);
		
		if (this.locks[key]) {
			var lock = this.locks[key];
			if (lock.type != 'sh') {
				this.logError('lock', "Lock is incorrect type (expected shared): " + key);
				return;
			}
			
			if (lock.readers > 0) {
				lock.readers--;
				this.logDebug(9, "Removing reader from shared lock: " + key, { readers: lock.readers });
				if (lock.readers > 0) return;
			}
			
			// all readers gone, so treat as exclusive and fully unlock key
			lock.type = 'ex';
			this.unlock(key);
		}
	},
	
	waitForQueueDrain: function(callback) {
		// wait for queue to finish all pending tasks
		if (this.queue.idle()) callback();
		else {
			this.logDebug(3, "Waiting for queue to finish " + this.queue.running() + " active and " + this.queue.length() + " pending tasks");
			this.queue.drain = callback;
		}
	},
	
	waitForAllLocks: function(callback) {
		// wait for all locks to release before proceeding
		var self = this;
		var num_locks = Tools.numKeys(this.locks);
		
		if (num_locks) {
			this.logDebug(3, "Waiting for " + num_locks + " locks to be released", Object.keys(this.locks));
			
			async.whilst(
				function () {
					return (Tools.numKeys(self.locks) > 0);
				},
				function (callback) {
					setTimeout( function() { callback(); }, 250 );
				},
				function() {
					// all locks released
					self.logDebug(9, "All locks released.");
					callback();
				}
			); // whilst
		}
		else callback();
	},
	
	logTransaction: function(type, key, data) {
		// proxy request to system logger with correct component
		if (this.maxRecentEvents) {
			if (!this.recentEvents[type]) this.recentEvents[type] = [];
			this.recentEvents[type].push({
				date: Tools.timeNow(),
				type: type,
				key: key,
				data: data
			});
			if (this.recentEvents[type].length > this.maxRecentEvents) {
				this.recentEvents[type].shift();
			}
		}
		
		if (this.logEventTypes[type] || this.logEventTypes['all']) {
			this.logger.set( 'component', this.__name );
			this.logger.transaction( type, key, data );
		}
	},
	
	tick: function() {
		// called every second by pixl-server
		
		// rotate and log second perf metrics
		var metrics = this.lastSecondMetrics = this.perf.getMinMaxMetrics();
		
		if (Tools.numKeys(metrics) && (this.logEventTypes.perf_sec || this.logEventTypes.all)) {
			this.logger.print({ 
				component: this.__name,
				category: 'perf', 
				code: 'second', 
				msg: "Last Second Performance Metrics", 
				data: metrics 
			});
			if (this.engine.cache) {
				this.logger.print({ 
					component: this.__name,
					category: 'cache', 
					code: 'second', 
					msg: "Last Second Cache Stats", 
					data: this.engine.cache.getStats()
				});
			}
		}
		
		// import perf into minutePerf
		this.minutePerf.import( this.perf );
		
		// and reset second perf
		this.perf.reset();
	},
	
	tickMinute: function() {
		// called every minute by pixl-server
		
		// rotate and log minute perf metrics
		var metrics = this.lastMinuteMetrics = this.minutePerf.getMinMaxMetrics();
		
		if (Tools.numKeys(metrics) && (this.logEventTypes.perf_min || this.logEventTypes.all)) {
			this.logger.print({ 
				component: this.__name,
				category: 'perf', 
				code: 'minute', 
				msg: "Last Minute Performance Metrics", 
				data: metrics 
			});
			if (this.engine.cache) {
				this.logger.print({ 
					component: this.__name,
					category: 'cache', 
					code: 'minute', 
					msg: "Last Minute Cache Stats", 
					data: this.engine.cache.getStats()
				});
			}
		}
		
		// and reset minute perf
		this.minutePerf.reset();
	},
	
	getStats: function() {
		// get perf and other misc stats
		var stats = {
			version: this.version,
			engine: this.engine.__name,
			concurrency: this.concurrency,
			transactions: !!this.transactions,
			last_second: this.lastSecondMetrics,
			last_minute: this.lastMinuteMetrics,
			recent_events: this.recentEvents,
			queue: {
				active: this.queue.running(),
				pending: this.queue.length()
			},
			locks: {}
		};
		
		// locks have actual callback functions, so convert to JSON-friendly
		for (var key in this.locks) {
			var lock = this.locks[key];
			if (lock.type == 'ex') {
				stats.locks[key] = { type: 'exclusive', clients: lock.clients.length + 1 };
			}
			else if (lock.type == 'sh') {
				stats.locks[key] = { type: 'shared', readers: lock.readers };
			}
		}
		
		return stats;
	},
	
	shutdown: function(callback) {
		// shutdown storage
		var self = this;
		this.logDebug(2, "Shutting down storage system");
		
		this.waitForQueueDrain( function() {
			// queue drained, now wait for locks
			
			self.waitForAllLocks( function() {
				// all locks released, now shutdown engine
				
				if (self.engine) self.engine.shutdown(callback);
				else callback();
				
			} ); // waitForLocks
		} ); // waitForQueueDrain
	}
	
});
