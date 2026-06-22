// Postgres Storage Plugin
// Copyright (c) 2026 Joseph Huckaby
// Released under the MIT License

// Requires the 'pg' module

const fs = require('fs');
const Path = require('path');
const zlib = require('zlib');
const os = require('os');
const cp = require('child_process');
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
		passwordPlugin: "",
		passwordPluginTimeout: 30000,
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
			delete: `DELETE FROM ${pg_config.table} WHERE key = $key`,
			transPut: `INSERT INTO ${pg_config.table} (key, value, modified) SELECT * FROM unnest($keys::text[], $values::bytea[], $modified::bigint[]) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified = EXCLUDED.modified`,
			transDelete: `DELETE FROM ${pg_config.table} WHERE key = ANY($keys::text[])`
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
		var pool_config = Tools.copyHashRemoveKeys( pg_config, { cache: 1, table: 1, passwordPlugin: 1, passwordPluginTimeout: 1 } );
		
		if (pg_config.passwordPlugin) {
			// node-postgres supports password as a sync/async callback, called for each
			// new physical connection.  We use that hook to ask an external command for
			// short-lived provider tokens without baking provider-specific code in here.
			pool_config.password = this.getPasswordFromPlugin.bind(this);
		}
		
		var db = this.db = new pg.Pool( pool_config );
		
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
		// run query against the pool
		this.queryWithClient( this.db, sql, args, callback );
	},
	
	getPasswordFromPlugin: function() {
		// execute an external command to resolve the Postgres password
		// the plugin may also return a TTL, allowing us to cache it in memory
		var self = this;
		var pg_config = this.config.get();
		var now = Date.now();
		
		if (this.passwordPluginCache && (now < this.passwordPluginCache.expires)) {
			return Promise.resolve( this.passwordPluginCache.password );
		}
		
		// If a plugin call is already in-flight, return the same Promise.
		// This coalesces simultaneous pool reconnects into one plugin exec.
		if (this.passwordPluginFetch) return this.passwordPluginFetch;
		
		var hook_args = {
			type: 'postgres_password',
			config: Tools.copyHashRemoveKeys( pg_config, { password: 1, passwordPlugin: 1, passwordPluginTimeout: 1 } )
		};
		
		var child_cmd = pg_config.passwordPlugin;
		var child_opts = {
			cwd: os.tmpdir(),
			timeout: pg_config.passwordPluginTimeout || 30000
		};
		
		this.logDebug(5, "Calling Postgres password plugin");
		
		this.passwordPluginFetch = new Promise( function(resolve, reject) {
			var child = cp.exec( child_cmd, child_opts, function(err, stdout, stderr) {
				var json = null;
				
				if (!err && stdout.match(/\S/)) {
					// parse last line only, to omit any noise from plugin
					try { json = JSON.parse( stdout.replace(/\r\n/g, "\n").trim().split(/\n/).pop() ); }
					catch (e) {
						err = new Error("Postgres password plugin JSON parse error: " + (e.message || e));
						err.code = 'json';
					}
				}
				
				if (stderr && stderr.match(/\S/)) {
					self.logDebug(9, "Postgres password plugin emitted STDERR: " + Buffer.byteLength(stderr) + " bytes");
				}
				
				if (err) return reject( err );
				if (!json) return reject( new Error("Postgres password plugin error: No JSON found in response STDOUT") );
				if (json.code) return reject( new Error("Postgres password plugin error: " + (json.description || json.code)) );
				if (typeof(json.password) != 'string') return reject( new Error("Postgres password plugin error: No password string found in response JSON") );
				
				var ttl = parseInt( json.ttl || 0, 10 ) || 0;
				
				if (ttl > 0) {
					self.passwordPluginCache = {
						password: json.password,
						expires: Date.now() + (ttl * 1000)
					};
					
					self.logDebug(6, "Postgres password plugin returned password with TTL: " + ttl + " seconds");
				}
				else {
					self.passwordPluginCache = null;
					self.logDebug(6, "Postgres password plugin returned password without TTL");
				}
				
				resolve( json.password );
			} ); // cp.exec
			
			// Write hook data to child's stdin, using one compact JSON document.
			child.stdin.on('error', noop);
			child.stdin.write( JSON.stringify(hook_args) + "\n" );
			child.stdin.end();
		} ).then( function(password) {
			self.passwordPluginFetch = null;
			return password;
		}, function(err) {
			self.passwordPluginFetch = null;
			throw err;
		} );
		
		return this.passwordPluginFetch;
	},
	
	queryWithClient: function(client, sql, args, callback) {
		// run and log db query, and error if applicable
		// allow for named variables in sql, expand to numbered $ variables for pg
		var self = this;
		if (!args) args = {};
		
		// perform $ placeholder substitution to populate sargs array
		var sargs = [];
		sql = sql.replace(/\$(\w+)/g, function(m_all, name) {
			var value = args[name];
			sargs.push(value);
			value = '$' + sargs.length;
			return value;
		} );
		
		client.query( sql, sargs, function(err, res) {
			if (err) {
				self.logError('db', "Failed to execute SQL: " + err, { sql, err });
				return callback(err);
			}
			
			self.logDebug(9, "SQL query completed successfully", {
				command: res.command || '',
				rowCount: res.rowCount || 0
			});
			
			callback(null, res);
		} ); // client.query
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

				if (self.cache && !self.storage.isBinaryKey(key)) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}

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
					catch (e) {
						self.logError('pg', "Failed to parse JSON record: " + key + ": " + e);
						callback( e, null );
						return;
					}
					self.logDebug(9, "Cached JSON fetch complete: " + key, self.debugLevel(10) ? data : null);

					callback( null, data );
				} );
			}
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

				if (self.cache && !is_binary) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}

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

				if (self.cache && !self.storage.isBinaryKey(key)) {
					// store 'empty' stub in cache
					self.cache.set( key, Buffer.alloc(0), { date: 0 } );
				}

				return callback(err);
			}
			self.logDebug(9, "Delete complete: " + key);

			// possibly "delete" from LRU cache as well
			if (self.cache && !self.storage.isBinaryKey(key)) {
				// store 'empty' stub in cache
				self.cache.set( key, Buffer.alloc(0), { date: 0 } );
			}
			callback();
		} ); // query
	},
	
	commitTransaction: function(trans, callback) {
		// commit all transaction actions using a native Postgres transaction
		// IMPORTANT: all queries must run on this one checked-out client
		var self = this;
		var did_begin = false;
		var write_keys = [];
		var write_values = [];
		var write_modified = [];
		var delete_keys = [];
		var bad_state = null;
		var query_step = '';
		
		this.logDebug(5, "Beginning transaction commit: " + trans.id, {
			path: trans.path,
			actions: Tools.numKeys(trans.keys)
		});
		
		Object.keys(trans.keys).forEach( function(key) {
			var record_state = trans.keys[key];
			var norm_key = self.storage.normalizeKey(key);
			
			if (record_state == 'W') {
				// Collect writes into parallel arrays for one bulk UPSERT below.
				var item = trans.values[key];
				write_keys.push( self.prepKey(norm_key) );
				write_values.push( Buffer.from( JSON.stringify( item.data ) ) );
				write_modified.push( item.mod );
			}
			else if (record_state == 'D') {
				// Collect deletes into one bulk DELETE below.
				delete_keys.push( self.prepKey(norm_key) );
			}
			else {
				bad_state = new Error("Unknown transaction record state: " + record_state + ": " + key);
			}
		});
		
		if (bad_state) return callback(bad_state);
		
		this.db.connect( function(err, client, release) {
			if (err) {
				self.logError('pg', "Failed to acquire Postgres client for transaction commit: " + err);
				return callback(err);
			}
			
			var releaseClient = function(err) {
				// release the pg client exactly once
				if (!release) return;
				var rel = release;
				release = null;
				rel(err);
			};
			
			async.series(
				[
					function(callback) {
						// start native Postgres transaction
						query_step = 'BEGIN';
						self.queryWithClient( client, "BEGIN", {}, function(err) {
							if (!err) did_begin = true;
							callback(err);
						} );
					},
					function(callback) {
						// delete all final-deleted records in one set-based SQL statement
						if (!delete_keys.length) return callback();
						
						query_step = 'DELETE';
						self.queryWithClient( client, self.commands.transDelete, {
							keys: delete_keys
						}, function(err, res) {
							if (err) return callback(err);
							
							if (res.rowCount < delete_keys.length) {
								self.logDebug(5, "Some records were already deleted", {
									requested: delete_keys.length,
									deleted: res.rowCount
								});
							}
							
							callback();
						} );
					},
					function(callback) {
						// upsert all final-written records in one set-based SQL statement
						if (!write_keys.length) return callback();
						
						query_step = 'UPSERT';
						self.queryWithClient( client, self.commands.transPut, {
							keys: write_keys,
							values: write_values,
							modified: write_modified
						}, callback );
					},
					function(callback) {
						// atomically reveal all transaction actions
						query_step = 'COMMIT';
						self.queryWithClient( client, "COMMIT", {}, callback );
					}
				],
				function(err) {
					if (!err) {
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
						
						releaseClient();
						return callback();
					}
					
					self.logError('pg', "Transaction commit failed: " + err);
					
					// If COMMIT itself fails, the outcome may be unknowable from the app side:
					// Postgres may have committed, but the client may have lost the response.
					// Surface this to the outer transaction layer as a fatal consistency error.
					if (query_step == 'COMMIT') {
						err.fatal = true;
					}
					
					if (!did_begin) {
						releaseClient(err);
						return callback(err);
					}
					
					// rollback best-effort.  If this fails, discard the client from the pool.
					self.queryWithClient( client, "ROLLBACK", {}, function(rollback_err) {
						if (rollback_err) {
							self.logError('pg', "Transaction rollback failed: " + rollback_err);
							err.fatal = true;
							err.rollbackError = rollback_err;
							releaseClient(rollback_err);
						}
						else {
							self.logDebug(5, "Transaction rollback complete: " + trans.id);
							releaseClient();
						}
						
						callback(err);
					} );
				}
			); // series
		} ); // db.connect
	},
	
	unitTestCleanup: function(callback) {
		// cleanup all unit test data, leaving the table itself intact
		var self = this;
		var table = this.config.get('table');
		
		this.logDebug(3, "Cleaning up Postgres unit test table: " + table);
		
		this.query( `TRUNCATE TABLE ${table}`, {}, function(err) {
			if (err) {
				self.logError('pg', "Failed to cleanup Postgres unit test table: " + err);
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
	
	optimize: function(callback) {
		// run Postgres VACUUM on the storage table
		var self = this;
		var table = this.config.get('table');
		var perf = new Perf();
		var vacuum = null;
		
		this.logDebug(3, "Running Postgres optimization", { table: table });
		perf.setScale(1);
		perf.begin();
		vacuum = perf.begin('vacuum');
		
		this.query( `VACUUM ${table}`, {}, function(err, res) {
			vacuum.end();
			perf.end();
			
			if (err) {
				err.message = "Postgres optimization failed: " + err.message;
				self.logError('pg', '' + err);
				return callback(err);
			}
			
			var report = {
				engine: self.__name,
				optimized: true,
				table: table,
				perf: perf.metrics(),
				operations: [
					{
						name: 'vacuum',
						ok: true,
						command: res.command || 'VACUUM',
						rowCount: res.rowCount || 0
					}
				]
			};
			
			self.logDebug(3, "Postgres optimization complete", report);
			callback(null, report);
		} );
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
