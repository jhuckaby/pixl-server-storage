// Postgres Storage Plugin
// Copyright (c) 2026 Joseph Huckaby
// Released under the MIT License

// Requires the 'pg' module

const fs = require('fs');
const Path = require('path');
const zlib = require('zlib');
const Class = require("pixl-class");
const Component = require("pixl-server/component");
const pg = require('pg');
const Tools = require("pixl-tools");
const Perf = require("pixl-perf");
const Cache = require("pixl-cache");
const async = require('async');
const noop = function() {};

module.exports = Class.create({
	
	__name: 'Postgres',
	__parent: Component,
	
	defaultConfig: {
		min: 0,
		max: 32,
		host: "localhost",
		database: "",
		user: "",
		password: "",
		port: 5432,
		statement_timeout: 5000,
		query_timeout: 6000,
		connectionTimeoutMillis: 30000,
		idleTimeoutMillis: 10000,
		table: "items"
	},
	
	startup: function(callback) {
		// setup Postgres connection
		var self = this;
		this.logDebug(2, "Setting up Postgres", Tools.copyHashRemoveKeys( this.config.get(), { password:1 }) );
		this.setup(callback);
	},
	
	setup: function(callback) {
		// setup Postgres connection
		var self = this;
		var pg_config = this.config.get();
		
		this.commands = {
			create: `CREATE TABLE IF NOT EXISTS ${pg_config.table}( key TEXT PRIMARY KEY, value BYTEA NOT NULL, modified BIGINT NOT NULL )`,
			get: `SELECT modified, value FROM ${pg_config.table} WHERE key = $key LIMIT 1`,
			head: `SELECT modified, octet_length(value) AS len FROM ${pg_config.table} WHERE key = $key LIMIT 1`,
			put: `INSERT INTO ${pg_config.table} (key, value, modified) VALUES ($key, $value, $now) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified = EXCLUDED.modified`,
			delete: `DELETE FROM ${pg_config.table} WHERE key = $key`
		};
		
		// optional LRU cache
		this.cache = null;
		var cache_opts = pg_config.cache;
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
		
		// pass entire config to pg.Pool, sans our custom keys
		var db = this.db = new pg.Pool( 
			Tools.copyHashRemoveKeys( pg_config, { cache: 1, table: 1 }) 
		);
		
		db.on('error', function(err) {
			self.logError('db', "DB Error: " + err, err);
			if (callback) { callback(err); callback = null; }
		});
		db.on('connect', function(client) {
			self.logDebug(9, "Opened DB pool connection");
		});
		db.on('remove', function(client) {
			self.logDebug(9, "Closed DB pool connection");
		});
		
		// create initial table
		this.logDebug(3, "Creating initial table: " + pg_config.table);
		this.query( this.commands.create, {}, function(err, res) {
			if (err) self.logError('db', "Failed to create initial table: " + err, err);
			else self.logDebug(3, "Setup complete");
			if (callback) { callback(err); callback = null; }
		} );
	},
	
	query(sql, args, callback) {
		// run and log db query, and error if applicable
		// allow for named variables in sql, expand to numbered $ variables for pg
		var self = this;
		
		// perform $ placeholder substitution to populate sargs array
		var sargs = [];
		sql = sql.replace(/\$(\w+)/g, function(m_all, name) {
			var value = args[name];
			sargs.push(value);
			value = '$' + sargs.length;
			return value;
		} );
		
		this.db.query( sql, sargs, function(err, res) {
			if (err) {
				self.logError('db', "Failed to execute SQL: " + err, { sql, err });
				return callback(err);
			}
			
			self.logDebug(9, "SQL query completed successfully", {
				command: res.command || '',
				rowCount: res.rowCount || 0
			});
			
			callback(null, res);
		} ); // db.query
	},
	
	prepKey: function(key) {
		// prepare key (no-op)
		return key;
	},
	
	put: function(key, value, callback) {
		// store key+value in Postgres
		var self = this;
		var now = Tools.timeNow(true);
		key = this.prepKey(key);
		
		var is_binary = this.storage.isBinaryKey(key);
		
		if (is_binary) {
			this.logDebug(9, "Storing Postgres Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing Postgres JSON Object: " + key, this.debugLevel(10) ? value : null);
			value = Buffer.from( JSON.stringify( value ) );
		}
		
		this.query( this.commands.put, { key: key, value: value, now: now }, function(err, res) {
			if (err) {
				err.message = "Failed to store object: " + key + ": " + err;
				self.logError('pg', '' + err);
				if (callback) callback(err);
				return;
			}
			
			self.logDebug(9, "Store complete: " + key);
			// possibly cache in LRU
			if (self.cache && !is_binary) {
				self.cache.set( key, value, { date: now } );
			}
			if (callback) callback(null);
		} ); // query
	},
	
	putStream: function(key, inp, callback) {
		// store key+value in Postgres using read stream
		var self = this;
		
		// The Postgres API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		var chunks = [];
		var done = false;
		var finish = function(err) {
			if (done) return;
			done = true;
			callback(err);
		};
		
		inp.on('error', function(err) {
			err.message = "Failed to store stream: " + key + ": " + err;
			self.logError('pg', '' + err);
			finish(err);
		} );
		inp.on('data', function(chunk) {
			if (done) return;
			chunks.push( chunk );
		} );
		inp.on('end', function() {
			if (done) return;
			var buf = Buffer.concat(chunks);
			self.put( key, buf, finish );
		} );
	},
	
	head: function(key, callback) {
		// head pg item given key
		var self = this;
		key = this.prepKey(key);
		
		// check cache first
		if (this.cache && this.cache.has(key)) {
			var item = this.cache.getMeta(key);
			
			process.nextTick( function() {
				self.logDebug(9, "Cached head complete: " + key);
				callback( null, {
					mod: item.date,
					len: item.value.length
				} );
			} );
			return;
		} // cache
		
		this.query( this.commands.head, { key: key }, function(err, res) {
			if (err) {
				err.message = "Failed to head key: " + key + ": " + err;
				self.logError('pg', '' + err);
				callback(err);
				return;
			}
			
			var row = res.rows[0];
			
			if (!row) {
				var err = new Error("Failed to head key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback(err, null);
			}
			callback(null, { mod: parseInt(row.modified, 10), len: row.len });
		} ); // query
	},
	
	get: function(key, callback) {
		// fetch Postgres value given key
		var self = this;
		key = this.prepKey(key);
		
		var is_binary = this.storage.isBinaryKey(key);
		
		// check cache first
		if (this.cache && !is_binary && this.cache.has(key)) {
			var data = this.cache.get(key);
			
			process.nextTick( function() {
				try { data = JSON.parse( data.toString() ); }
				catch (e) {
					self.logError('pg', "Failed to parse JSON record: " + key + ": " + e);
					callback( e, null );
					return;
				}
				self.logDebug(9, "Cached JSON fetch complete: " + key, self.debugLevel(10) ? data : null);
				
				callback( null, data );
			} );
			return;
		} // cache
		
		this.logDebug(9, "Fetching Postgres Object: " + key);
		
		this.query( this.commands.get, { key: key }, function(err, res) {
			if (err) {
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('pg', '' + err);
				callback(err);
				return;
			}
			
			var row = res.rows[0];
			
			if (!row) {
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback(err, null);
			}
			if (is_binary) {
				self.logDebug(9, "Binary fetch complete: " + key, '' + row.value.length + ' bytes');
				return callback(null, row.value);
			}
			if (self.cache) {
				self.cache.set( key, row.value, { date: parseInt(row.modified, 10) } );
			}
			var json = null;
			try { json = JSON.parse( row.value.toString() ); }
			catch (err) {
				self.logError('pg', "Failed to parse JSON record: " + key + ": " + err);
				return callback(err, null);
			}
			self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? json : null);
			callback(null, json);
		} ); // query
	},
	
	getBuffer: function(key, callback) {
		// fetch Postgres buffer given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching Postgres Object: " + key);
		
		this.query( this.commands.get, { key: key }, function(err, res) {
			if (err) {
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('pg', '' + err);
				callback(err);
				return;
			}
			
			var row = res.rows[0];
			
			if (!row) {
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback(err, null);
			}
			self.logDebug(9, "Binary fetch complete: " + key, '' + row.value.length + ' bytes');
			callback(null, row.value);
		} ); // query
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		
		// The Postgres API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.query( this.commands.get, { key: this.prepKey(key) }, function(err, res) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('pg', '' + err);
				return callback(err);
			}
			
			var row = res.rows[0];
			
			if (!row) {
				// record not found
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback( err, null );
			}
			
			self.logDebug(9, "Binary fetch complete: " + key, '' + row.value.length + ' bytes');
			var stream = new BufferStream(row.value);
			callback(null, stream, { mod: parseInt(row.modified, 10), len: row.value.length });
		} ); // query
	},
	
	getStreamRange: function(key, start, end, callback) {
		// get readable stream to record value given key and range
		var self = this;
		
		// The Postgres API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.query( this.commands.get, { key: this.prepKey(key) }, function(err, res) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('pg', '' + err);
				return callback(err);
			}
			
			var row = res.rows[0];
			
			if (!row) {
				// record not found
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback( err, null );
			}
			
			var buf = row.value;
			
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
			callback(null, stream, { mod: parseInt(row.modified, 10), len: buf.length });
		} ); // query
	},
	
	delete: function(key, callback) {
		// delete Postgres key given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Deleting Postgres Object: " + key);
		
		this.query( this.commands.delete, { key: key }, function(err, res) {
			if (err) {
				self.logError('pg', "Failed to delete object: " + key + ": " + err);
				callback(err);
				return;
			}
			
			if (!res.rowCount) {
				var err = new Error("Failed to delete object: " + key + ": Not found");
				err.code = "NoSuchKey";
				return callback(err);
			}
			self.logDebug(9, "Delete complete: " + key);
			if (self.cache && self.cache.has(key)) {
				self.cache.delete(key);
			}
			callback();
		} ); // query
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		var self = this;
		this.logDebug(2, "Shutting down Postgres");
		
		if (this.db) {
			this.db.end( function(err) {
				if (err) self.logError('pg', "Failed to shutdown database cleanly: " + err);
				else self.logDebug(3, "Shutdown complete");
				delete self.db;
				callback();
			} );
		}
		else {
			this.logDebug(3, "Shutdown complete");
			callback();
		}
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
