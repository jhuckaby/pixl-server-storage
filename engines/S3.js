// Amazon AWS S3 Storage Plugin
// Copyright (c) 2015 - 2019 Joseph Huckaby
// Released under the MIT License

// Requires the 'aws-sdk' module from npm
// npm install aws-sdk

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var AWS = require('aws-sdk');
var Cache = require("pixl-cache");

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
		
		this.logDebug(2, "Setting up Amazon S3 (" + aws_config.region + ")");
		this.logDebug(3, "S3 Bucket ID: " + s3_config.params.Bucket);
		
		this.keyPrefix = (s3_config.keyPrefix || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';
		delete s3_config.keyPrefix;
		
		this.keyTemplate = (s3_config.keyTemplate || '').replace(/^\//, '').replace(/\/$/, '');
		delete s3_config.keyTemplate;
		
		this.fileExtensions = !!s3_config.fileExtensions;
		delete s3_config.fileExtensions;
		
		if (this.debugLevel(10)) {
			// S3 has a logger API but it's extremely verbose -- restrict to level 10 only
			s3_config.logger = {
				log: function(msg) { self.logDebug(10, "S3 Debug: " + msg); }
			};
		}
		
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
		delete s3_config.cache;
		
		AWS.config.update( aws_config );
		this.s3 = new AWS.S3( s3_config );
	},
	
	prepKey: function(key) {
		// prepare key for S3 based on config
		var md5 = Tools.digestHex(key, 'md5');
		
		var ns = '';
		if (key.match(/^([\w\-\.]+)\//)) ns = RegExp.$1;
		
		if (this.keyPrefix) {
			key = this.keyPrefix + key;
		}
		
		if (this.keyTemplate) {
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
		
		var params = {};
		params.Key = this.extKey(key, orig_key);
		params.Body = value;
		
		// serialize json if needed
		if (is_binary) {
			this.logDebug(9, "Storing S3 Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing S3 JSON Object: " + key, this.debugLevel(10) ? params.Body : null);
			params.Body = JSON.stringify( params.Body );
			params.ContentType = 'application/json';
		}
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.putObject( params, function(err, data) {
			if (done) return; else done = true;
			
			if (err) {
				self.logError('s3', "Failed to store object: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Store complete: " + key);
			
			// possibly cache in LRU
			if (self.cache && !is_binary) {
				self.cache.set( orig_key, params.Body, { date: Tools.timeNow(true) } );
			}
			
			if (callback) callback(err, data);
		} );
	},
	
	putStream: function(key, inp, callback) {
		// store key+stream of data to S3
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		var params = {};
		params.Key = this.extKey(key, orig_key);
		params.Body = inp;
		
		this.logDebug(9, "Storing S3 Binary Stream: " + key);
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.upload(params, function(err, data) {
			if (done) return; else done = true;
			
			if (err) {
				self.logError('s3', "Failed to store stream: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Stream store complete: " + key);
			
			if (callback) callback(err, data);
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
			process.nextTick( function() {
				var item = self.cache.getMeta(orig_key);
				self.logDebug(9, "Cached head complete: " + orig_key);
				callback( null, {
					mod: item.date,
					len: item.value.length
				} );
			} );
			return;
		} // cache
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.headObject( { Key: this.extKey(key, orig_key) }, function(err, data) {
			if (done) return; else done = true;
			
			if (err) {
				if (err.code != 'NoSuchKey') {
					self.logError('s3', "Failed to head key: " + key + ": " + err.message);
				}
				callback( err, null );
				return;
			}
			
			self.logDebug(9, "Head complete: " + key);
			callback( null, {
				mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
				len: data.ContentLength
			} );
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
			process.nextTick( function() {
				var data = self.cache.get(orig_key);
				
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
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.getObject( { Key: this.extKey(key, orig_key) }, function(err, data) {
			if (done) return; else done = true;
			
			if (err) {
				if (err.code == 'NoSuchKey') {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
					err.code = "NoSuchKey";
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + err.message);
				}
				callback( err, null );
				return;
			}
			
			var body = null;
			if (is_binary) {
				body = data.Body;
				self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
			}
			else {
				body = data.Body.toString();
				
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
			
			callback( null, body );
		} );
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Fetching S3 Stream: " + key);
		
		var params = { Key: this.extKey(key, orig_key) };
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.headObject( params, function(err) {
			if (done) return; else done = true;
			
			if (err) {
				if (err.code != 'NoSuchKey') {
					self.logError('s3', "Failed to head key: " + key + ": " + err.message);
				}
				callback( err, null );
				return;
			}
			
			var download = self.s3.getObject(params).createReadStream();
			
			download.once('error', function(err) {
				self.logError('s3', "Failed to download key: " + key + ": " + err.message);
			});
			download.once('end', function() {
				self.logDebug(9, "S3 stream download complete: " + key);
			} );
			download.once('close', function() {
				self.logDebug(9, "S3 stream download closed: " + key);
			} );
			
			callback( null, download );
		}); // headObject
	},
	
	delete: function(key, callback) {
		// delete s3 key given key
		var self = this;
		var orig_key = key;
		key = this.prepKey(key);
		
		this.logDebug(9, "Deleting S3 Object: " + key);
		
		// double-callback protection (bug in aws-sdk)
		var done = false;
		this.s3.deleteObject( { Key: this.extKey(key, orig_key) }, function(err, data) {
			if (done) return; else done = true;
			
			if (err) {
				self.logError('s3', "Failed to delete object: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Delete complete: " + key);
			
			// possibly delete from LRU cache as well
			if (self.cache && self.cache.has(orig_key)) {
				self.cache.delete(orig_key);
			}
			
			if (callback) callback(err, data);
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
