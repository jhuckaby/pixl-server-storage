// Unit tests for Storage System - Transactions
// Copyright (c) 2015 - 2016 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');

module.exports = {
	tests: [
		
		function testTransactionEnable(test) {
			// enable transaction support
			// wait for queue and locks first
			var self = this;
			
			var first = true;
			async.whilst(
				function () {
					return ( first || (Object.keys(self.storage.locks).length > 0) || !self.storage.queue.idle() );
				},
				function (callback) {
					test.debug("Waiting for locks / queue");
					first = false;
					setTimeout( function() { callback(); }, 250 );
				},
				function() {
					// all locks released and queue idle
					
					// enable transactions in config
					self.storage.config.set('transactions', 1);
					
					// init transactions
					self.storage.initTransactions( function() {
						test.ok( true, "Initialized transaction system" );
						test.done();
					} ); // initTransactions
				} // no locks
			); // whlist
		},
		
		function testTransactionBasic(test) {
			// basic transaction
			var self = this;
			var storage = this.storage;
			var trans = null;
			
			var orig = {
				orig1: { value: "orig value 1" }, // will be untouched
				orig2: { value: "orig value 2" }, // will be changed
				orig3: { value: "orig value 3" }  // will be deleted
			};
			
			async.series(
				[
					function(callback) {
						// get some initial data in first
						storage.putMulti( orig, callback );
					},
					function(callback) {
						// begin the transaction
						storage.begin( "transtest", function(err, t) {
							if (err) return callback(err);
							trans = t;
							callback();
						});
					},
					
					// make some changes inside the transaction
					function(callback) { trans.put( "transtest", { value: "brand new" }, callback ); },
					function(callback) { trans.put( "orig2", { value: "changed 2" }, callback ); },
					function(callback) { trans.delete( "orig3", callback ); },
					
					// validate changes inside transaction
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "changed 2" },
							"orig3": false, // deleted
							"transtest": { "/value": "brand new" }
						}, trans, callback );
					},
					
					// make sure changes didn't take effect OUTSIDE transaction
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "orig value 2" },
							"orig3": { "/value": "orig value 3" },
							"transtest": false // not created yet
						}, storage, callback );
					},
					
					// commit transaction
					function(callback) {
						trans.commit( callback );
					},
					
					// make sure changes took
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "changed 2" },
							"orig3": false, // deleted
							"transtest": { "/value": "brand new" }
						}, storage, callback );
					},
					
					// make sure transaction object can no longer be used
					// (expecting error here)
					function(callback) {
						trans.put( "something", "other", function(err) {
							if (!err) return callback( new Error("Expected error using transaction after commit, got success instead.") );
							else callback();
						});
					},
					
					// cleanup
					function(callback) {
						storage.deleteMulti( ['orig1', 'orig2', 'transtest'], callback );
					}
					
				],
				function(err) {
					test.ok( !err, "Transaction Error: " + err );
					test.done();
				}
			); // series
		},
		
		// abort (rollback)
		function testTransactionAbort(test) {
			// abort transaction
			var self = this;
			var storage = this.storage;
			var trans = null;
			
			var orig = {
				orig1: { value: "orig value 1" }, // will be untouched
				orig2: { value: "orig value 2" }, // will be changed
				orig3: { value: "orig value 3" }  // will be deleted
			};
			
			async.series(
				[
					function(callback) {
						// get some initial data in first
						storage.putMulti( orig, callback );
					},
					function(callback) {
						// begin the transaction
						storage.begin( "transtest", function(err, t) {
							if (err) return callback(err);
							trans = t;
							callback();
						});
					},
					
					// make some changes inside the transaction
					function(callback) { trans.put( "transtest", { value: "brand new" }, callback ); },
					function(callback) { trans.put( "orig2", { value: "changed 2" }, callback ); },
					function(callback) { trans.delete( "orig3", callback ); },
					
					// validate changes inside transaction
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "changed 2" },
							"orig3": false, // deleted
							"transtest": { "/value": "brand new" }
						}, trans, callback );
					},
					
					// make sure changes didn't take effect OUTSIDE transaction
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "orig value 2" },
							"orig3": { "/value": "orig value 3" },
							"transtest": false // not created yet
						}, storage, callback );
					},
					
					// abort transaction
					function(callback) {
						trans.abort( callback );
					},
					
					// make sure changes reverted
					function(callback) {
						self.multiCheck({
							"orig1": { "/value": "orig value 1" },
							"orig2": { "/value": "orig value 2" },
							"orig3": { "/value": "orig value 3" },
							"transtest": false
						}, storage, callback );
					},
					
					// cleanup
					function(callback) {
						storage.deleteMulti( ['orig1', 'orig2', 'orig3'], callback );
					}
					
				],
				function(err) {
					test.ok( !err, "Transaction Error: " + err );
					test.done();
				}
			); // series
		},
		
		// compound function transaction
		function testTransactionCompound(test) {
			// basic transaction
			var self = this;
			var storage = this.storage;
			var trans = null;
			
			async.series(
				[
					function(callback) {
						// create initial list
						storage.listPush( 'comptranslist', { value: 'init_1' }, callback );
					},
					function(callback) {
						// create initial hash
						storage.hashPut( 'comptranshash', 'hkey1', { value: 'init_2' }, callback );
					},
					function(callback) {
						// begin the transaction
						storage.begin( "comptranstest", function(err, t) {
							if (err) return callback(err);
							trans = t;
							callback();
						});
					},
					
					// make some changes inside the transaction
					function(callback) { trans.listPush( "comptranslist", { value: "brand_new" }, callback ); },
					function(callback) { trans.hashPut( "comptranshash", "hkey2", { value: "yoyo_3" }, callback ); },
					
					// validate changes inside transaction
					function(callback) {
						self.multiCheck({
							"comptranslist": { "/length": 2 },
							"comptranslist/0": {
								"/items/0/value": "init_1",
								"/items/1/value": "brand_new" 
							},
							"comptranshash": { "/length": 2 },
							"comptranshash/data": {
								"/items/hkey1/value": "init_2",
								"/items/hkey2/value": "yoyo_3"
							}
						}, trans, callback );
					},
					
					// make sure changes didn't take effect OUTSIDE transaction
					function(callback) {
						self.multiCheck({
							"comptranslist": { "/length": 1 },
							"comptranslist/0": {
								"/items/0/value": "init_1",
								"/items/1/value": null
							},
							"comptranshash": { "/length": 1 },
							"comptranshash/data": {
								"/items/hkey1/value": "init_2",
								"/items/hkey2/value": null
							}
						}, storage, callback );
					},
					
					// commit transaction
					function(callback) {
						trans.commit( callback );
					},
					
					// make sure changes took
					function(callback) {
						self.multiCheck({
							"comptranslist": { "/length": 2 },
							"comptranslist/0": {
								"/items/0/value": "init_1",
								"/items/1/value": "brand_new" 
							},
							"comptranshash": { "/length": 2 },
							"comptranshash/data": {
								"/items/hkey1/value": "init_2",
								"/items/hkey2/value": "yoyo_3"
							}
						}, storage, callback );
					},
					
					// cleanup
					function(callback) {
						storage.listDelete( 'comptranslist', true, callback );
					},
					function(callback) {
						storage.hashDeleteAll( 'comptranshash', true, callback );
					}
					
				],
				function(err) {
					test.ok( !err, "Transaction Error: " + err );
					test.done();
				}
			); // series
		}
		
	] // tests array
};
