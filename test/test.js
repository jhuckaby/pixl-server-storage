// Unit tests for Storage System
// Copyright (c) 2015 - 2018 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');

var Class = require("pixl-class");
var PixlServer = require('pixl-server');
var Tools = require('pixl-tools');

process.chdir( __dirname );

var base_data_dir = path.join( os.tmpdir(), 'pixl-server-storage-unit-test-data' );

var server = new PixlServer({
	
	__name: 'Mock Server',
	__version: "1.0",
	
	configFile: "config.json",
	
	components: [
		require("../storage.js")
	]
	
});

// Unit Tests

var mainTests = require('./test-main.js');
var listTests = require('./test-list.js');
var hashTests = require('./test-hash.js');
var transactionTests = require('./test-transaction.js');
var indexerTests = require('./test-indexer.js');

module.exports = {
	setUp: function (callback) {
		var self = this;
		this.server = server;
		
		// hook server prestart to massage config to our liking
		server.on('prestart', function() {
			var storage_config = server.Storage.config.get();
			
			// optionally swap out engine on CLI
			if (self.args.engine) storage_config.engine = self.args.engine;
			
			// override Filesystem base dir to go somewhere more sane
			if (storage_config.Filesystem) storage_config.Filesystem.base_dir = base_data_dir;
		});
		
		// delete old unit test log
		cp.exec("rm -rf storage.log " + base_data_dir, function(err, stdout, stderr) {
			// startup mock server
			server.startup( function() {
				// startup complete
				
				// write log in sync mode, for troubleshooting
				server.logger.set('sync', true);
				
				// save ref to storage
				self.storage = server.Storage;
				
				// build our test array dynamically
				// we have some repeating tests with different configuration options
				self.tests = self.tests.concat( 
					listTests.tests, 
					
					(self.args.splice || self.args.all || self.args.comprehensive) ? 
						listTests.generateSpliceTests() : [],
					
					hashTests.tests 
				);
				
				// now add transaction tests, which enable and init transactions
				self.tests = self.tests.concat( transactionTests.tests );
				
				// now repeat list and hash tests, with transactions enabled
				// augment test names for clarity
				[].concat( listTests.tests, hashTests.tests ).forEach( function(func) {
					var wrapper = function(test) { func.apply(this, [test]); };
					wrapper.testName = 'Transaction_' + func.name;
					self.tests.push( wrapper );
				} );
				
				// finally add indexer tests
				self.tests = self.tests.concat( indexerTests.tests );
				
				// startup complete
				// delay this by 1ms so the log is in the correct order (pre-start is async)
				setTimeout( function() { callback(); }, 1 );
			} ); // startup
		} ); // delete
	},
	
	beforeEach: function(test) {
		this.storage.logDebug(9, "BEGIN UNIT TEST: " + test.name);
	},
	
	afterEach: function(test) {
		this.storage.logDebug(9, "END UNIT TEST: " + test.name);
	},
	
	onAssertFailure: function(test, msg, data) {
		this.storage.logDebug(9, "UNIT ASSERT FAILURE: " + test.file + ": " + test.name + ": " + msg, data);
	},
	
	tests: [].concat(
		mainTests.tests
	),
	
	tearDown: function (callback) {
		// clean up
		this.server.shutdown( function() {
			cp.exec("rm -rf transactions " + base_data_dir, callback);
		} );
	},
	
	multiCheck: function(map, storage, callback) {
		// check multiple records against map
		// map format: { key: { "/xpath/thingy": "asserted value" }, key2: false (deleted) }
		async.forEachOfLimit( map, storage.concurrency,
			function(xpaths, key, callback) {
				// fetch record
				storage.get( key, function(err, data) {
					if (err) {
						if (!xpaths) return callback(); // expected
						return callback(err);
					}
					
					for (var xpath in xpaths) {
						var value = Tools.lookupPath( xpath, data );
						if (value != xpaths[xpath]) {
							// console.log( "DATA: ", data );
							return callback( new Error("Data Mismatch: " + key + ": " + xpath + ": " + value + " != " + xpaths[xpath]) );
						}
					}
					
					callback();
				}); // get
			},
			callback
		);
	},
	
	multiIndexSearch: function(map, index_config, test, callback) {
		// perform multiple index searches in series, add assertions to test
		var self = this;
		
		async.forEachOfLimit( map, 1,
			function(expected, squery, callback) {
				// search records
				self.storage.searchRecords( squery, index_config, function(err, results) {
					if (expected === false) {
						test.ok( !!err, "Error expected with query: " + squery );
						return callback();
					}
					
					test.ok( !err, "No error searching record: " + err );
					
					test.debug("Search: "+squery+" -- results:", results);
					test.ok( !!results, "Got results from search" );
					test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
					
					var keys = Object.keys(results);
					test.ok( keys.length == Object.keys(expected).length, "Found correct number of records: " + keys.length );
					
					for (var key in expected) {
						test.ok( !!results[key], "Found record " + key + " in results" );
					}
					
					callback();
				} );
			},
			callback
		);
	}
};
