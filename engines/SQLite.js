// SQLite Storage Plugin
// Copyright (c) 2023 Joseph Huckaby
// Released under the MIT License

// Requires the 'sqlite3' module from npm
// npm install --save sqlite3

const fs = require('fs');
const Path = require('path');
const zlib = require('zlib');
const Class = require("pixl-class");
const Component = require("pixl-server/component");
const SQLite3 = require('sqlite3');
const Tools = require("pixl-tools");
const Perf = require("pixl-perf");
const async = require('async');
const noop = function() {};

module.exports = Class.create({
	
	__name: 'SQLite',
	__parent: Component,
	
	defaultConfig: {
		base_dir: '',
		filename: 'sqlite.db',
		keyPrefix: "",
		keyTemplate: ""
	},
	
	startup: function(callback) {
		// setup SQLite connection
		var self = this;
		this.logDebug(2, "Setting up SQLite", this.config.get() );
		this.setup(callback);
	},
	
	setup: function(callback) {
		// setup SQLite connection
		var self = this;
		var sql_config = this.config.get();
		
		this.keyPrefix = (sql_config.keyPrefix || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';
		
		this.keyTemplate = (sql_config.keyTemplate || '').replace(/^\//, '').replace(/\/$/, '');
		
		this.baseDir = sql_config.base_dir || process.cwd();
		this.commands = {};
		
		// create initial data dir if necessary
		try {
			Tools.mkdirp.sync( this.baseDir ); 
		}
		catch (e) {
			var msg = "FATAL ERROR: Base directory could not be created: " + this.baseDir + ": " + e;
			this.logError('sqlite', msg);
			throw new Error(msg);
		}
		
		var db_file = Path.join( this.baseDir, sql_config.filename );
		this.logDebug(3, "Opening database file: " + db_file);
		
		async.series([
			function(callback) {
				self.db = new SQLite3.Database( db_file, callback );
			},
			function(callback) {
				// optionally set pragmas on the db
				if (!sql_config.pragmas) return process.nextTick(callback);
				async.eachSeries( Object.keys(sql_config.pragmas),
					function(key, callback) {
						var value = sql_config.pragmas[key];
						self.db.run(`PRAGMA ${key} = ${value};`, callback);
					},
					callback
				); // eachSeries
			},
			function(callback) {
				// create our table if necessary
				self.db.run( 'CREATE TABLE IF NOT EXISTS items( key TEXT PRIMARY KEY, value BLOB, modified INTEGER )', callback );
			},
			function(callback) {
				self.commands.get = self.db.prepare( 'SELECT value FROM items WHERE key = $key LIMIT 1', callback );
			},
			function(callback) {
				self.commands.head = self.db.prepare( 'SELECT modified, length(value) FROM items WHERE key = $key LIMIT 1', callback );
			},
			function(callback) {
				self.commands.put = self.db.prepare( 'INSERT INTO items VALUES($key, $value, $now) ON CONFLICT (key) DO UPDATE SET value = $value, modified = $now WHERE key = $key', callback );
			},
			function(callback) {
				self.commands.delete = self.db.prepare( 'DELETE FROM items WHERE key = $key', callback );
			}
		], 
		function(err) {
			if (err) {
				self.logError('sqlite', "FATAL ERROR: Database setup failed: " + err);
				return callback(err);
			}
			self.logDebug(3, "Setup complete");
			callback();
		}); // async.series
	},
	
	prepKey: function(key) {
		// prepare key based on config
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
		// store key+value in SQLite
		var self = this;
		var now = Tools.timeNow(true);
		key = this.prepKey(key);
		
		if (this.storage.isBinaryKey(key)) {
			this.logDebug(9, "Storing SQLite Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing SQLite JSON Object: " + key, this.debugLevel(10) ? value : null);
			value = Buffer.from( JSON.stringify( value ) );
		}
		
		this.commands.put.run({ $key: key, $value: value, $now: now }, function(err) {
			if (err) {
				err.message = "Failed to store object: " + key + ": " + err;
				self.logError('sqlite', '' + err);
			}
			else self.logDebug(9, "Store complete: " + key);
			
			if (callback) callback(err);
		} ); // put
	},
	
	putStream: function(key, inp, callback) {
		// store key+value in SQLite using read stream
		var self = this;
		
		// The SQLite API has no stream support.
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
		// head sqlite item given key
		var self = this;
		key = this.prepKey(key);
		
		this.commands.head.get({ $key: key }, function(err, row) {
			if (err) {
				// an actual error
				err.message = "Failed to head key: " + key + ": " + err;
				self.logError('sqlite', '' + err);
				callback(err);
			}
			else if (!row) {
				// record not found
				// always use "NoSuchKey" in error code
				var err = new Error("Failed to head key: " + key + ": Not found");
				err.code = "NoSuchKey";
				callback( err, null );
			}
			else {
				callback( null, { mod: row.modified, len: row['length(value)'] } );
			}
		}); // head
	},
	
	get: function(key, callback) {
		// fetch SQLite value given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching SQLite Object: " + key);
		
		this.commands.get.get({ $key: key }, function(err, row) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('sqlite', '' + err);
				callback(err);
			}
			else if (!row) {
				// record not found
				// always use "NoSuchKey" in error code
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				callback( err, null );
			}
			else {
				// success
				if (self.storage.isBinaryKey(key)) {
					self.logDebug(9, "Binary fetch complete: " + key, '' + row.value.length + ' bytes');
					callback( null, row.value );
				}
				else {
					var json = null;
					try { json = JSON.parse( row.value.toString() ); }
					catch (err) {
						self.logError('sqlite', "Failed to parse JSON record: " + key + ": " + err);
						callback( err, null );
						return;
					}
					self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? json : null);
					callback( null, json );
				}
			}
		}); // get
	},
	
	getBuffer: function(key, callback) {
		// fetch SQLite buffer given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching SQLite Object: " + key);
		
		this.commands.get.get({ $key: key }, function(err, row) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('sqlite', '' + err);
				callback(err);
			}
			else if (!row) {
				// record not found
				// always use "NoSuchKey" in error code
				var err = new Error("Failed to fetch key: " + key + ": Not found");
				err.code = "NoSuchKey";
				callback( err, null );
			}
			else {
				// success
				self.logDebug(9, "Binary fetch complete: " + key, '' + row.value.length + ' bytes');
				callback( null, row.value );
			}
		}); // get
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		
		// The SQLite API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.get( key, function(err, buf) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('sqlite', '' + err);
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
		
		// The SQLite API has no stream support.
		// So, we have to do this the RAM-hard way...
		
		this.get( key, function(err, buf) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('sqlite', '' + err);
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
				download.destroy();
				callback( new Error("Invalid byte range (" + start + '-' + end + ") for key: " + key + " (len: " + buf.length + ")"), null );
				return;
			}
			
			var range = buf.slice(start, end + 1);
			var stream = new BufferStream(range);
			callback(null, stream, { mod: 1, len: buf.length });
		} );
	},
	
	delete: function(key, callback) {
		// delete SQLite key given key
		var self = this;
		key = this.prepKey(key);
		
		this.logDebug(9, "Deleting SQLite Object: " + key);
		
		this.commands.delete.run({ $key: key }, function(err) {
			// In sqlite3 callbacks `this` is special, and contains `changes`
			if (!err && !this.changes) {
				err = new Error("Not found");
				err.code = "NoSuchKey";
			}
			if (err) {
				self.logError('sqlite', "Failed to delete object: " + key + ": " + err);
				err = new Error("Failed to delete object: " + key + ": " + err);
				return callback(err);
			}
			self.logDebug(9, "Delete complete: " + key);
			callback();
		}); // delete
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		// config.backups: { enabled, dir, filename, compress?, keep? }
		var self = this;
		var backups = this.config.get('backups') || null;
		if (!backups || !backups.enabled || !backups.dir || !backups.filename) return callback();
		
		// here be dragons: try to wait for a moment BETWEEN transaction commits, to minimize risk of an "inconsistent" backup
		if (this.storage.transactions && Tools.findObject(Object.values(this.storage.transactions), { committing: true })) {
			// wait for next commitEnd event and try again
			this.logDebug(9, "Maintenance: Transaction commit(s) are in progress, waiting until next commitEnd event...");
			
			this.storage.once('commitEnd', function(trans) {
				self.logDebug(9, "Maintenance: Transaction commit " + trans.id + " (" + trans.path + ") ended, retrying now...");
				self.runMaintenance(callback);
			});
			
			return;
		}
		
		// track perf for logging
		var perf = new Perf();
		perf.begin();
		perf.begin('prep');
		
		// allow dir & filename to have date/time placeholders, e.g. `backup-[yyyy]-[mm]-[dd].db`
		var dargs = Tools.getDateArgs( Tools.timeNow() );
		var file = Tools.sub( Path.join(backups.dir, backups.filename), dargs, true );
		if (!file) {
			this.logError('backup', "Failed to expand placeholders on backup file: " + backups.filename);
			return callback();
		}
		
		// strip .gz prefix, just in case the user added it
		file = file.replace(/\.gz$/i, '');
		
		// auto-create parent dirs as needed
		if (!fs.existsSync(backups.dir)) {
			try { Tools.mkdirp.sync(backups.dir); }
			catch (err) {
				this.logError('backup', "Failed to create backup directory: " + backups.dir);
				return callback();
			}
		}
		
		// here we go
		if (fs.existsSync(file)) fs.unlinkSync(file);
		this.logDebug(6, "Performing database backup to: " + file);
		perf.end('prep');
		
		var finish = function() {
			// all done
			perf.end();
			self.logDebug(6, "Maintenance complete", perf.metrics());
			callback();
		};
		
		var keep = function() {
			// delete oldest backups if over N on disk
			var files = Tools.findFilesSync( backups.dir, { stats: true } );
			if (files.length <= backups.keep) return finish();
			perf.begin('keep');
			
			self.logDebug(6, "There are " + files.length + " backup files in " + backups.dir + ", keeping the latest " + backups.keep);
			
			// sort mtime descending so the newest are at the start of the array, then splice those off, leaving only the oldest to delete
			Tools.sortBy( files, 'mtime', { type: 'number', dir: -1 } );
			files.splice( 0, backups.keep );
			
			files.forEach( function(file) {
				self.logDebug(7, "Deleting old backup file: " + file.path, file);
				try { fs.unlinkSync(file.path); } catch (err) {
					self.logError('backup', "Failed to delete backup file: " + file.path + ": " + err);
				}
			} );
			
			perf.end('keep');
			finish();
		}; // keep
		
		var compress = function() {
			// compress backup and delete original
			var gz_file = file + '.gz';
			perf.begin('compress');
			
			if (fs.existsSync(gz_file)) fs.unlinkSync(gz_file);
			self.logDebug(6, "Compressing backup to: " + gz_file);
			
			var gzip = zlib.createGzip();
			var inp = fs.createReadStream( file );
			var outp = fs.createWriteStream( gz_file );
			
			var handleError = function(err) {
				self.logError('backup', "Failed to compress backup: " + gz_file + ": " + err);
				fs.unlink(gz_file, noop);
				
				perf.end('compress');
				if (backups.keep) keep();
				else finish();
			};
			
			gzip.on('error', handleError);
			inp.on('error', handleError);
			outp.on('error', handleError);
			
			inp.pipe(gzip).pipe(outp).on('finish', function() {
				self.logDebug(6, "Backup compression complete: " + gz_file);
				fs.unlink(file, noop);
				
				perf.end('compress');
				if (backups.keep) keep();
				else finish();
			} );
		}; // compress
		
		// Perform the backup -- unfortunately this locks the DB, and we can't use progressive mode
		// because of how we handle transactions "outside" of SQLite's control.
		perf.begin('backup');
		
		this.db.run('VACUUM INTO $filename', { $filename: Path.resolve(file) }, function(err) {
			perf.end('backup');
			if (err) {
				self.logError('backup', "SQLite backup operation failed: " + err);
				fs.unlink(file, noop);
				return finish();
			}
			
			self.logDebug(6, "SQLite backup operation completed: " + file);
			
			// now compress or keep or done
			if (backups.compress) compress();
			else if (backups.keep) keep();
			else finish();
		});
	},
	
	shutdown: function(callback) {
		// shutdown storage
		var self = this;
		this.logDebug(2, "Shutting down SQLite");
		
		if (this.db) {
			// finalize all statements and close db
			async.eachSeries( Object.keys(this.commands),
				function(key, callback) {
					self.commands[key].finalize(callback);
				},
				function() {
					self.db.close( function(err) {
						if (err) self.logError('sqlite', "Failed to shutdown database cleanly: " + err);
						else self.logDebug(3, "Shutdown complete");
						callback();
					} );
					self.db = null;
					self.commands = null;
				}
			); // eachSeries
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
