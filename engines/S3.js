// SimpleTask Amazon AWS S3 Storage Plugin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var AWS = require('aws-sdk');

module.exports = Class.create({
	
	__name: 'S3',
	__parent: Component,
	
	startup: function(callback) {
		// setup Amazon AWS connection
		var self = this;
		this.logDebug(2, "Setting up Amazon S3");
		
		this.setup();
		this.config.on('reload', function() { self.setup(); } );
		
		callback();
	},
	
	setup: function() {
		// setup AWS connection
		AWS.config.update( this.storage.config.get('AWS') || this.server.config.get('AWS') );
		this.s3 = new AWS.S3( this.config.get() );
	},
	
	put: function(key, value, callback) {
		// store key+value in s3
		var self = this;
		
		var params = {};
		params.Key = key;
		params.Body = value;
		
		// serialize json if needed
		if (this.storage.isBinaryKey(key)) {
			this.logDebug(9, "Storing S3 Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			params.Body = JSON.stringify( params.Body );
			params.ContentType = 'application/json';
			this.logDebug(9, "Storing S3 JSON Object", params);
		}
		
		this.s3.putObject( params, function(err, data) {
			if (err) {
				self.logError('s3', "Failed to store object: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Store complete: " + key);
			
			if (callback) callback(err, data);
		} );
	},
	
	head: function(key, callback) {
		// head s3 value given key
		var self = this;
		
		this.logDebug(9, "Pinging S3 Object: " + key);
		
		this.s3.headObject( { Key: key }, function(err, data) {
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
		
		this.logDebug(9, "Fetching S3 Object: " + key);
		
		this.s3.getObject( { Key: key }, function(err, data) {
			if (err) {
				if (err.code == 'NoSuchKey') {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + key + ": Not found");
				}
				else {
					// some other error
					self.logError('s3', "Failed to fetch key: " + key + ": " + err.message);
				}
				callback( err, null );
				return;
			}
			
			var body = null;
			if (this.storage.isBinaryKey(key)) {
				body = data.Body;
				self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
			}
			else {
				body = data.Body.toString();
				try { body = JSON.parse( body ); }
				catch (e) {
					self.logError('s3', "Failed to parse JSON record: " + key + ": " + e);
					callback( e, null );
					return;
				}
				self.logDebug(9, "JSON fetch complete: " + key, body);
			}
			
			callback( null, body );
		} );
	},
	
	delete: function(key, callback) {
		// delete s3 key given key
		var self = this;
		
		this.logDebug(9, "Deleting S3 Object: " + key);
		
		this.s3.deleteObject( { Key: key }, function(err, data) {
			if (err) {
				self.logError('s3', "Failed to delete object: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Delete complete: " + key);
			
			if (callback) callback(err, data);
		} );
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down AWS storage");
		delete this.s3;
		callback();
	}
	
});
