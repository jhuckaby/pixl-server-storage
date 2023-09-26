// Amazon AWS S3 Storage Plugin
// Copyright (c) 2015 - 2022 Joseph Huckaby
// Released under the MIT License

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var Cache = require("pixl-cache");
var S3 = require("@aws-sdk/client-s3");
var { Upload } = require("@aws-sdk/lib-storage");
var { NodeHttpHandler } = require("@smithy/node-http-handler");
var streamToBuffer = require("fast-stream-to-buffer");
var StreamMeter = require("stream-meter");

module.exports = Class.create({
	
	__name: 'S3',
	__parent: Component,
	
	startup: function(callback) {
		// setup Amazon AWS connection
		var self = this;
		
		this.setup();
		// this.config.on('reload', function() { self.setup(); } );
		
		callback();
	},
	
	setup: function() {
		// setup AWS connection
		var self = this;
		var aws_config = this.storage.config.get('AWS') || this.server.config.get('AWS');
		var s3_config = this.config.get();
		
		this.logDebug(5, "Setting up Amazon S3 (" + aws_config.region + ")");
		this.logDebug(6, "S3 Bucket ID: " + s3_config.params.Bucket);
		
		this.keyPrefix = (s3_config.keyPrefix || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';
		
		this.keyTemplate = (s3_config.keyTemplate || '').replace(/^\//, '').replace(/\/$/, '');
		this.fileExtensions = !!s3_config.fileExtensions;
		this.pretty = !!s3_config.pretty;
		
		// optional LRU cache
		this.cache = null;
		var cache_opts = s3_config.cache;
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
		
		// merge AWS and S3 configs
		var combo_config = Tools.mergeHashes( aws_config, s3_config );
		
		// convert v2 config to v3
		if (!combo_config.maxAttempts && combo_config.maxRetries) {
			combo_config.maxAttempts = combo_config.maxRetries;
			delete combo_config.maxRetries;
		}
		if (combo_config.accessKeyId) {
			if (!combo_config.credentials) combo_config.credentials = {};
			combo_config.credentials.accessKeyId = combo_config.accessKeyId;
			delete combo_config.accessKeyId;
		}
		if (combo_config.secretAccessKey) {
			if (!combo_config.credentials) combo_config.credentials = {};
			combo_config.credentials.secretAccessKey = combo_config.secretAccessKey;
			delete combo_config.secretAccessKey;
		}
		delete combo_config.correctClockSkew;
		delete combo_config.httpOptions;
		delete combo_config.keyPrefix;
		delete combo_config.keyTemplate;
		delete combo_config.fileExtensions;
		delete combo_config.pretty;
		delete combo_config.cache;
		
		this.s3Params = combo_config.params || {};
		delete combo_config.params;
		
		// allow user to specify HTTP timeout options for S3
		if (combo_config.connectTimeout || combo_config.socketTimeout) {
			combo_config.requestHandler = new NodeHttpHandler({
				connectionTimeout: combo_config.connectTimeout || 0,
				socketTimeout: combo_config.socketTimeout || 0
			});
			delete combo_config.connectTimeout;
			delete combo_config.socketTimeout;
		}
		
		this.s3 = new S3.S3Client(combo_config);
	},
	
	prepKey: function(key) {
		// prepare key for S3 based on config
		var ns = '';
		if (key.match(/^([\w\-\.]+)\//)) ns = RegExp.$1;
		
		if (this.keyPrefix) {
			key = this.keyPrefix + key;
		}
		
		if (this.keyTemplate) {
			var md5 = Tools.digestHex(key, 'md5');
			var idx = 0;
			var temp = this.keyTemplate.replace( /\#/g, function() {
				return md5.substr(idx++, 1);
			} );
			key = Tools.sub( temp, { key: key, md5: md5, ns: ns } );
		}
		
		return key;
	},
	
	extKey: function(key, orig_key) {
		// possibly add suffix to key, if fileExtensions mode is enabled
		// and key is not binary
		if (this.fileExtensions && !this.storage.isBinaryKey(orig_key)) {
			key += '.json';
		}
		return key;
	},
	
	put: function(key, value, callback) {
		// store key+value in s3
		var self = this;
		var orig_key = key;
		var is_binary = this.storage.isBinaryKey(key);
		key = this.prepKey(key);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		params.Body = value;
		
		// serialize json if needed
		if (is_binary) {
			this.logDebug(9, "Storing S3 Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing S3 JSON Object: " + key, this.debugLevel(10) ? params.Body : null);
			params.Body = this.pretty ? JSON.stringify( params.Body, null, "\t" ) : JSON.stringify( params.Body );
			params.ContentType = 'application/json';
		}
		
		this.s3.send( new S3.PutObjectCommand(params) )
			.then( function(data) {
				self.logDebug(9, "Store complete: " + key);
				self.storage.emit('billing', 's3_put', 1);
				
				// possibly cache in LRU
				if (self.cache && !is_binary) {
					self.cache.set( orig_key, params.Body, { date: Tools.timeNow(true) } );
				}
				
				if (callback) process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				if (err.name == 'SlowDown') {
					// special behavior for SlowDown errors
					self.logDebug(6, "Received SlowDown from S3 put: " + orig_key + ": " + err + " (will retry)");
					self.storage.emit('slowDown');
					setTimeout( function() { self.put(orig_key, value, callback); }, 1000 );
					return;
				}
				self.logError('s3', "Failed to store object: " + key + ": " + (err.message || err), err);
				if (callback) process.nextTick( function() { callback(err); });
			} );
	},
	
	putStream: function(key, inp, callback) {
		// store key+stream of data to S3
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		var meter = new StreamMeter();
		inp.pipe(meter);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		params.Body = meter;
		
		this.logDebug(9, "Storing S3 Binary Stream: " + key);
		
		var upload = new Upload({
			client: this.s3,
			params: params
		});
		
		upload.done()
			.then( function(data) {
				self.logDebug(9, "Stream store complete: " + key);
				self.storage.emit('billing', 's3_put', 1);
				self.storage.emit('billing', 's3_bytes_out', meter.bytes);
				if (callback) process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				self.logError('s3', "Failed to store stream: " + key + ": " + (err.message || err), err);
				if (callback) process.nextTick( function() { callback(err, null); });
			} );
	},
	
	putStreamCustom: function(key, inp, opts, callback) {
		// store key+stream of data to S3, inc options
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		var meter = new StreamMeter();
		inp.pipe(meter);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		params.Body = meter;
		if (opts) Tools.mergeHashInto(params, opts);
		
		this.logDebug(9, "Storing S3 Binary Stream: " + key);
		
		var upload = new Upload({
			client: this.s3,
			params: params
		});
		
		upload.done()
			.then( function(data) {
				self.logDebug(9, "Stream store complete: " + key);
				self.storage.emit('billing', 's3_put', 1);
				self.storage.emit('billing', 's3_bytes_out', meter.bytes);
				if (callback) process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				self.logError('s3', "Failed to store stream: " + key + ": " + (err.message || err), err);
				if (callback) process.nextTick( function() { callback(err, null); });
			} );
	},
	
	head: function(key, callback) {
		// head s3 value given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Pinging S3 Object: " + key);
		
		// check cache first
		if (this.cache && this.cache.has(orig_key)) {
			var item = this.cache.getMeta(orig_key);
			
			process.nextTick( function() {
				self.logDebug(9, "Cached head complete: " + orig_key);
				callback( null, {
					mod: item.date,
					len: item.value.length
				} );
			} );
			return;
		} // cache
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		this.s3.send( new S3.HeadObjectCommand(params) )
			.then( function(data) {
				self.logDebug(9, "Head complete: " + key);
				self.storage.emit('billing', 's3_head', 1);
				
				process.nextTick( function() {
					callback( null, {
						mod: Math.floor( (new Date(data.LastModified)).getTime() / 1000 ),
						len: data.ContentLength
					} );
				} );
			} )
			.catch( function(err) {
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to head key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else if (err.name == 'SlowDown') {
					// special behavior for SlowDown errors
					self.logDebug(6, "Received SlowDown from S3 head: " + orig_key + ": " + err + " (will retry)");
					self.storage.emit('slowDown');
					setTimeout( function() { self.head(orig_key, callback); }, 1000 );
					return;
				}
				else {
					// some other error
					self.logError('s3', "Failed to head key: " + key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err ); } );
			} );
	},
	
	get: function(key, callback) {
		// fetch s3 value given key
		var self = this;
		var orig_key = key;
		var is_binary = this.storage.isBinaryKey(key);
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching S3 Object: " + key);
		
		// check cache first
		if (this.cache && !is_binary && this.cache.has(orig_key)) {
			var data = this.cache.get(orig_key);
			
			process.nextTick( function() {	
				try { data = JSON.parse( data ); }
				catch (e) {
					self.logError('file', "Failed to parse JSON record: " + orig_key + ": " + e);
					callback( e, null );
					return;
				}
				self.logDebug(9, "Cached JSON fetch complete: " + orig_key, self.debugLevel(10) ? data : null);
				
				callback( null, data );
			} );
			return;
		} // cache
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				// stream to buffer
				streamToBuffer( data.Body, function (err, body) {
					if (err) {
						self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
						return callback(err);
					}
					
					self.storage.emit('billing', 's3_get', 1);
					self.storage.emit('billing', 's3_bytes_in', body.length);
					
					if (is_binary) {
						self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
					}
					else {
						body = body.toString();
						
						// possibly cache in LRU
						if (self.cache) {
							self.cache.set( orig_key, body, { date: Tools.timeNow(true) } );
						}
						
						try { body = JSON.parse( body ); }
						catch (e) {
							self.logError('s3', "Failed to parse JSON record: " + key + ": " + e);
							callback( e, null );
							return;
						}
						self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? body : null);
					}
					
					callback( null, body, {
						mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
						len: data.ContentLength
					} );
				} ); // streamToBuffer
			} )
			.catch( function(err) {
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else if (err.name == 'SlowDown') {
					// special behavior for SlowDown errors
					self.logDebug(6, "Received SlowDown from S3 get: " + orig_key + ": " + err + " (will retry)");
					self.storage.emit('slowDown');
					setTimeout( function() { self.get(orig_key, callback); }, 1000 );
					return;
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err ); } );
			} );
	},
	
	getBuffer: function(key, callback) {
		// fetch s3 buffer given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching S3 Object: " + key);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				// stream to buffer
				streamToBuffer( data.Body, function (err, body) {
					if (err) {
						self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
						return callback(err);
					}
					
					self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
					self.storage.emit('billing', 's3_get', 1);
					self.storage.emit('billing', 's3_bytes_in', body.length);
					
					callback( null, body, {
						mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
						len: data.ContentLength
					} );
				} ); // streamToBuffer
			} )
			.catch( function(err) {
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else if (err.name == 'SlowDown') {
					// special behavior for SlowDown errors
					self.logDebug(6, "Received SlowDown from S3 getBuffer: " + orig_key + ": " + err + " (will retry)");
					self.storage.emit('slowDown');
					setTimeout( function() { self.getBuffer(orig_key, callback); }, 1000 );
					return;
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err ); } );
			} );
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching S3 Stream: " + key);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				var download = data.Body;
				
				download.on('error', function(err) {
					self.logError('s3', "Failed to download key: " + key + ": " + (err.message || err), err);
				});
				download.once('end', function() {
					self.logDebug(9, "S3 stream download complete: " + key);
				} );
				download.once('close', function() {
					self.logDebug(9, "S3 stream download closed: " + key);
				} );
				
				self.storage.emit('billing', 's3_get', 1);
				self.storage.emit('billing', 's3_bytes_in', data.ContentLength);
				
				process.nextTick( function() {
					callback( null, download, {
						mod: Math.floor( (new Date(data.LastModified)).getTime() / 1000 ),
						len: data.ContentLength
					} );
				} );
			})
			.catch( function(err) {
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err ); } );
			});
	},
	
	getStreamRange: function(key, start, end, callback) {
		// get readable stream to record value given key and range
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching ranged S3 stream: " + key, { start, end });
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		// convert start/end to HTTP range header string
		var range = "bytes=";
		if (!isNaN(start)) range += start;
		range += '-';
		if (!isNaN(end)) range += end;
		
		params.Range = range;
		
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				var download = data.Body;
				
				download.on('error', function(err) {
					self.logError('s3', "Failed to download key: " + key + ": " + (err.message || err), err);
				});
				download.once('end', function() {
					self.logDebug(9, "S3 stream download complete: " + key);
				} );
				download.once('close', function() {
					self.logDebug(9, "S3 stream download closed: " + key);
				} );
				
				self.storage.emit('billing', 's3_get', 1);
				self.storage.emit('billing', 's3_bytes_in', data.ContentRange);
				
				// get full length from the ContentRange header
				var len = 0;
				if (data.ContentRange && data.ContentRange.toString().match(/\/\s*(\d+)\s*$/)) {
					len = parseInt( RegExp.$1 );
				}
				
				process.nextTick( function() { 
					callback( null, download, {
						mod: Math.floor( (new Date(data.LastModified)).getTime() / 1000 ),
						len: len,
						cr: data.ContentRange
					} );
				} );
			})
			.catch( function(err) {
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err ); } );
			});
	},
	
	delete: function(key, callback) {
		// delete s3 key given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Deleting S3 Object: " + key);
		
		var params = Tools.copyHash( this.s3Params );
		params.Key = this.extKey(key, orig_key);
		
		this.s3.send( new S3.DeleteObjectCommand(params) )
			.then( function(data) {
				self.logDebug(9, "Delete complete: " + key);
				self.storage.emit('billing', 's3_delete', 1);
				
				// possibly delete from LRU cache as well
				if (self.cache && self.cache.has(orig_key)) {
					self.cache.delete(orig_key);
				}
				
				if (callback) process.nextTick( function() { callback(null, data); } );
			} )
			.catch( function(err) {
				if (err.name == 'SlowDown') {
					// special behavior for SlowDown errors
					self.logDebug(6, "Received SlowDown from S3 delete: " + orig_key + ": " + err + " (will retry)");
					self.storage.emit('slowDown');
					setTimeout( function() { self.delete(orig_key, callback); }, 1000 );
					return;
				}
				self.logError('s3', "Failed to delete object: " + key + ": " + (err.message || err), err);
				if (callback) process.nextTick( function() { callback(err); } );
			} );
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down S3 storage");
		delete this.s3;
		callback();
	}
	
});
