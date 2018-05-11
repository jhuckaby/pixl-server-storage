// Storage System - Standalone Mode
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var Class = require("pixl-class");
var Config = require("pixl-config");
var Storage = require("pixl-server-storage");
var EventEmitter = require('events');

var server = new EventEmitter();
server.debug = false;
server.config = new Config({});

server.logger = {
	get: function(key) { return (key == 'debugLevel') ? 9 : ''; },
	set: function(key, value) { this[key] = value; },
	debug: function(level, msg, data) {
		if (server.debug) {
			if (data) msg += " (" + JSON.stringify(data) + ")";
			console.log('[' + ((new Date()).getTime() / 1000) + '][DEBUG] ' + msg);
		}
	},
	error: function(code, msg, data) {
		if (data) msg += " (" + JSON.stringify(data) + ")";
		console.log('[' + ((new Date()).getTime() / 1000) + '][ERROR]['+code+'] ' + msg);
	},
	transaction: function(code, msg, data) {
		if (data) msg += " (" + JSON.stringify(data) + ")";
		console.log('[' + ((new Date()).getTime() / 1000) + '][TRANSACTION]['+code+'] ' + msg);
	}
};

module.exports = Class.create({
	
	__parent: Storage,
	
	__construct: function(config, callback) {
		if (config.logger) {
			server.logger = config.logger;
			delete config.logger;
		}
		
		this.config = new Config(config);
		server.debug = !!this.config.get('debug');
		
		this.init( server, this.config );
		server.Storage = this;
		
		process.nextTick( function() {
			server.Storage.startup( callback || function() {;} );
		} );
	}
	
});
