// Hybrid Storage Plugin
// Copyright (c) 2015 - 2020 Joseph Huckaby
// Released under the MIT License

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var async = require('async');

module.exports = Class.create({
	
	__name: 'Hybrid',
	__parent: Component,
	
	defaultConfig: {
		binaryEngine: "",
		docEngine: ""
	},
	
	startup: function(callback) {
		// setup multiple sub-engines
		this.logDebug(2, "Setting up hybrid engine", this.config.get() );
		
		var binaryClass = require( './' + this.config.get('binaryEngine') + '.js' );
		this.binaryEngine = new binaryClass();
		this.binaryEngine.storage = this.storage;
		this.binaryEngine.init( this.server, this.storage.config.getSub( this.config.get('binaryEngine') ) );
		
		var docClass = require( './' + this.config.get('docEngine') + '.js' );
		this.docEngine = new docClass();
		this.docEngine.storage = this.storage;
		this.docEngine.init( this.server, this.storage.config.getSub( this.config.get('docEngine') ) );
		
		async.series([
			this.binaryEngine.startup.bind(this.binaryEngine),
			this.docEngine.startup.bind(this.docEngine)
		], callback );
	},
	
	put: function(key, value, callback) {
		// store key+value in hybrid system
		if (this.storage.isBinaryKey(key)) {
			this.binaryEngine.put( key, value, callback );
		}
		else {
			this.docEngine.put( key, value, callback );
		}
	},
	
	putStream: function(key, inp, callback) {
		// store key+value in hybrid system using read stream
		// streams are binary only!
		this.binaryEngine.putStream( key, inp, callback );
	},
	
	head: function(key, callback) {
		// head hybrid value given key
		if (this.storage.isBinaryKey(key)) {
			this.binaryEngine.head( key, callback );
		}
		else {
			this.docEngine.head( key, callback );
		}
	},
	
	get: function(key, callback) {
		// fetch hybrid value given key
		if (this.storage.isBinaryKey(key)) {
			this.binaryEngine.get( key, callback );
		}
		else {
			this.docEngine.get( key, callback );
		}
	},
	
	getBuffer: function(key, callback) {
		// fetch hybrid buffer given key
		if (this.storage.isBinaryKey(key)) {
			this.binaryEngine.getBuffer( key, callback );
		}
		else {
			this.docEngine.getBuffer( key, callback );
		}
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		// streams are binary only!
		this.binaryEngine.getStream( key, callback );
	},
	
	getStreamRange: function(key, start, end, callback) {
		// get readable stream to record value given key and range
		// streams are binary only!
		this.binaryEngine.getStreamRange( key, start, end, callback );
	},
	
	delete: function(key, callback) {
		// delete hybrid key given key
		if (this.storage.isBinaryKey(key)) {
			this.binaryEngine.delete( key, callback );
		}
		else {
			this.docEngine.delete( key, callback );
		}
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance
		async.series([
			this.binaryEngine.runMaintenance.bind(this.binaryEngine),
			this.docEngine.runMaintenance.bind(this.docEngine)
		], callback );
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down hybrid system");
		
		async.series([
			this.binaryEngine.shutdown.bind(this.binaryEngine),
			this.docEngine.shutdown.bind(this.docEngine)
		], callback );
	}
	
});
