// SimpleTask Couchbase Storage Plugin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

// Requires the 'couchbase' module from npm
// npm install couchbase

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var CouchbaseAPI = require('couchbase');

module.exports = Class.create({
	
	__name: 'Couchbase',
	__parent: Component,
	
	defaultConfig: {
		connect_string: "couchbase://127.0.0.1",
		bucket: "default",
		password: "",
		serialize: false
	},
	
	startup: function(callback) {
		// setup Couchbase connection
		var self = this;
		this.logDebug(2, "Setting up Couchbase");
		
		this.setup(callback);
		this.config.on('reload', function() { self.setup(); } );
	},
	
	setup: function(callback) {
		// setup Couchbase connection
		var self = this;
		
		this.cluster = new CouchbaseAPI.Cluster( this.config.get('connect_string') );
		if (this.config.get('password')) {
			this.bucket = this.cluster.openBucket( this.config.get('bucket'), this.config.get('password'), function(err) {
				callback(err);
			} );
		}
		else {
			this.bucket = this.cluster.openBucket( this.config.get('bucket'), function(err) {
				callback(err);
			} );
		}
	},
	
	put: function(key, value, callback) {
		// store key+value in Couchbase
		var self = this;
		
		if (this.storage.isBinaryKey(key)) {
			this.logDebug(9, "Storing Couchbase Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing Couchbase JSON Object: " + key, this.debugLevel(10) ? value : null);
			if (this.config.get('serialize')) value = JSON.stringify( value );
		}
		
		this.bucket.upsert( key, value, {}, function(err) {
			if (err) {
				self.logError('couchbase', "Failed to store object: " + key + ": " + err);
			}
			else self.logDebug(9, "Store complete: " + key);
			
			if (callback) callback(err);
		} );
	},
	
	head: function(key, callback) {
		// head couchbase value given key
		var self = this;
		
		// Note: From what I can tell from the Couchbase Node.JS 2.0 API,
		// there is simply no way to head / ping an object.
		// So, we have to do this the hard way...
		
		this.get( key, function(err, data) {
			if (err) return callback(err);
			callback( null, { mod: 1, len: data.length } );
		} );
	},
	
	get: function(key, callback) {
		// fetch Couchbase value given key
		var self = this;
		
		this.logDebug(9, "Fetching Couchbase Object: " + key);
		
		this.bucket.get( key, function(err, result) {
			if (!result) {
				if (err) {
					// some other error
					self.logError('couchbase', "Failed to fetch key: " + key + ": " + err.message);
					callback( err, null );
				}
				else {
					// record not found
					// always include "Not found" in error message
					callback(
						new Error("Failed to fetch key: " + key + ": Not found"),
						null
					);
				}
			}
			else {
				var body = result.value;
				
				if (self.storage.isBinaryKey(key)) {
					self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
				}
				else {
					if (self.config.get('serialize')) {
						try { body = JSON.parse( body.toString() ); }
						catch (e) {
							self.logError('couchbase', "Failed to parse JSON record: " + key + ": " + e);
							callback( e, null );
							return;
						}
					}
					self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? body : null);
				}
				
				callback( null, body );
			}
		} );
	},
	
	delete: function(key, callback) {
		// delete Couchbase key given key
		var self = this;
		
		this.logDebug(9, "Deleting Couchbase Object: " + key);
		
		this.bucket.remove( key, {}, function(err) {
			if (err) {
				self.logError('couchbase', "Failed to delete object: " + key + ": " + err.message);
			}
			else self.logDebug(9, "Delete complete: " + key);
			
			callback(err);
		} );
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down Couchbase");
		this.bucket.disconnect();
		callback();
	}
	
});
