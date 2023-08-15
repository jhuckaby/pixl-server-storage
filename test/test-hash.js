// Unit tests for Storage System - Hash
// Copyright (c) 2015 - 2020 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');
var Tools = require('pixl-tools');

// const BAD_KEYS = Object.getOwnPropertyNames( Object.prototype );
const BAD_KEYS = ['constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', 'toLocaleString'];

module.exports = {
	tests: [
	
		function hashCreate1(test) {
			test.expect(1);
			
			this.storage.hashCreate( 'hash1', { page_size: 10 }, function(err, data) {
				test.ok( !err, "No error creating hash1: " + err );
				test.done();
			} );
		},
		
		function hashGetAllEmpty1(test) {
			test.expect(2);
			
			this.storage.hashGetAll( 'hash1', function(err, items) {
				test.ok( !!items, "Expected hash for empty hash" );
				test.ok( Object.keys(items).length == 0, "Expected zero length in items hash on empty hash" );
				test.done();
			} );
		},
		
		function hashPut1(test) {
			var self = this;
			test.expect(2);
			
			this.storage.hashPut( 'hash1', 'key1', { foo: 'bar', number: 122 }, function(err) {
				test.ok( !err, "No error storing into hash: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function hashUpdate1(test) {
			var self = this;
			test.expect(2);
			
			this.storage.hashUpdate( 'hash1', 'key1', { number: 123 }, function(err) {
				test.ok( !err, "No error storing into hash: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function hashGet1(test) {
			var self = this;
			test.expect(15);
			
			this.storage.hashGet( 'hash1', 'key1', function(err, item) {
				test.ok( !err, "No error fetching hash key: " + err );
				test.ok( !!item, "Item is real" );
				test.ok( item.number == 123, "Hash item number matches" );
				test.ok( item.foo == 'bar', "Hash item value matches" );
				
				// check internals
				self.storage.get( 'hash1', function(err, hash) {
					test.ok( !err, "No error fetching hash header: " + err );
					test.ok( !!hash, "Got hash data from header key" );
					test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
					test.ok( hash.length == 1, "Hash length is 1: " + hash.length );
					test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
					
					self.storage.get( 'hash1/data', function(err, page) {
						test.ok( !err, "No error fetching hash page: " + err );
						test.ok( !!page, "Got hash page data" );
						test.ok( page.type == 'hash_page', "Page type is correct: " + page.type );
						test.ok( page.length == 1, "Page length is 1: " + page.length );
						test.ok( !!page.items, "Hash page has items" );
						test.ok( Object.keys(page.items).length == 1, "Hash page has 1 item" );
						test.done();
					} );
				} ); // internals
			} );
		},
		
		// hashDelete
		function hashDelete1(test) {
			var self = this;
			test.expect(13);
			
			this.storage.hashDelete( 'hash1', 'key1', function(err) {
				test.ok( !err, "No error deleting hash key: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// check internals
				self.storage.get( 'hash1', function(err, hash) {
					test.ok( !err, "No error fetching hash header: " + err );
					test.ok( !!hash, "Got hash data from header key" );
					test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
					test.ok( hash.length == 0, "Hash length is 0: " + hash.length );
					test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
					
					self.storage.get( 'hash1/data', function(err, page) {
						test.ok( !err, "No error fetching hash page: " + err );
						test.ok( !!page, "Got hash page data" );
						test.ok( page.type == 'hash_page', "Page type is correct: " + page.type );
						test.ok( page.length == 0, "Page length is 0: " + page.length );
						test.ok( !!page.items, "Hash page has items" );
						test.ok( Object.keys(page.items).length == 0, "Hash page has 0 items" );
						test.done();
					} );
				} ); // internals
			});
		},
		
		// hashPutMulti
		function hashPutMulti1(test) {
			// this will fill up one page but not overflow it
			var self = this;
			test.expect(13);
			
			var obj = {};
			for (var idx = 0; idx < 10; idx++) {
				obj[ 'key'+idx ] = "Value " + Math.floor(idx * 1000);
			}
			
			this.storage.hashPutMulti( 'hash1', obj, function(err) {
				test.ok( !err, "No error storing hash multikey: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// check internals
				self.storage.get( 'hash1', function(err, hash) {
					test.ok( !err, "No error fetching hash header: " + err );
					test.ok( !!hash, "Got hash data from header key" );
					test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
					test.ok( hash.length == 10, "Hash length is 10: " + hash.length );
					test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
					
					self.storage.get( 'hash1/data', function(err, page) {
						test.ok( !err, "No error fetching hash page: " + err );
						test.ok( !!page, "Got hash page data" );
						test.ok( page.type == 'hash_page', "Page type is correct: " + page.type );
						test.ok( page.length == 10, "Page length is 10: " + page.length );
						test.ok( !!page.items, "Hash page has items" );
						test.ok( Object.keys(page.items).length == 10, "Hash page has 10 items" );
						test.done();
					} );
				} ); // internals
			});
		},
		
		function hashPut2(test) {
			// cause a page overflow and reindex
			var self = this;
			test.expect(17);
			
			this.storage.hashPut( 'hash1', 'key10', "Value 10000", function(err) {
				test.ok( !err, "No error storing into hash: " + err );
				
				// key10 should trigger an async reindex, so we have to wait for that to complete
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
						// check internals
						self.storage.get( 'hash1', function(err, hash) {
							test.ok( !err, "No error fetching hash header: " + err );
							test.ok( !!hash, "Got hash data from header key" );
							test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
							test.ok( hash.length == 11, "Hash length is 11: " + hash.length );
							test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
							
							self.storage.get( 'hash1/data', function(err, page) {
								test.ok( !err, "No error fetching hash page: " + err );
								test.ok( !!page, "Got hash page data" );
								test.ok( page.type == 'hash_index', "Page type is correct: " + page.type );
								test.ok( !page.items, "Page no longer contains items" );
								
								self.storage.get( 'hash1/data/0', function(err, page) {
									test.ok( !err, "No error fetching nested hash page: " + err );
									test.ok( !!page, "Got nested hash page data" );
									test.ok( page.type == 'hash_page', "Nested page type is correct: " + page.type );
									test.ok( page.length == 1, "Nested page length is 1: " + page.length );
									test.ok( !!page.items, "Nested hash page has items" );
									test.ok( Object.keys(page.items).length == 1, "Nested hash page has 1 items" );
									
									// 'key9' has an MD5 that starts with '0', so we know it will be in hash1/data/0
									test.ok( page.items['key9'] == "Value 9000", "Nested hash page contains key9, and its value is correct" );
									test.done();
								} );
							} );
						} ); // internals
					} // idle
				); // whilst
			} ); // hashPut
		},
		
		// hashGetMulti
		function hashGetMulti1(test) {
			var self = this;
			var keys = ['key1', 'key3', 'key5', 'key7', 'key9'];
			var correct_values = ["Value 1000", "Value 3000", "Value 5000", "Value 7000", "Value 9000"];
			test.expect(8);
			
			this.storage.hashGetMulti( 'hash1', keys, function(err, values) {
				test.ok( !err, "No error fetching hash multikey: " + err );
				test.ok( !!values, "Got values in response");
				test.ok( values.length == 5, "Values has correct length: " + values.length);
				
				correct_values.forEach( function(value, idx) {
					test.ok( values[idx] == value, "Value correct for key: " + keys[idx] + ": " + values[idx]);
				} );
				
				test.done();
			});
		},
		
		// hashGetAll
		function hashGetAll1(test) {
			var self = this;
			test.expect(14);
			
			this.storage.hashGetAll( 'hash1', function(err, obj) {
				test.ok( !err, "No error fetching hash all: " + err );
				test.ok( !!obj, "Got object in resopnse" );
				test.ok( Object.keys(obj).length == 11, "Got 11 keys in response" );
				
				for (var idx = 0; idx < 11; idx++) {
					test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
				}
				
				test.done();
			});
		},
		
		// hashEach
		function hashEach1(test) {
			var self = this;
			var obj = {};
			
			this.storage.hashEach( 'hash1',
				function(key, value, callback) {
					obj[key] = value;
					callback();
				},
				function(err) {
					test.ok( !err, "No error fetching hash each: " + err );
					test.ok( Object.keys(obj).length == 11, "Got 11 keys in response" );
					
					for (var idx = 0; idx < 11; idx++) {
						test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
					}
					
					test.done();
				}
			);
		},
		
		function hashEachAbort1(test) {
			// abort hashEach in the middle
			var self = this;
			var obj = {};
			var count = 0;
			
			this.storage.hashEach( 'hash1',
				function(key, value, callback) {
					obj[key] = value;
					count++;
					if (count == 5) return callback(new Error("Abort!")); // abort
					else return callback();
				},
				function(err) {
					test.ok( !!err, "Error expected fetching hash each" );
					test.ok( err.message.toString().match(/abort/i), "Error message contains 'abort'" );
					test.ok( Object.keys(obj).length == 5, "Got 5 keys in response" );
					test.done();
				}
			);
		},
		
		// hashEachSync
		function hashEachSync1(test) {
			var self = this;
			var obj = {};
			
			this.storage.hashEachSync( 'hash1',
				function(key, value) {
					obj[key] = value;
				},
				function(err) {
					test.ok( !err, "No error fetching hash each: " + err );
					test.ok( Object.keys(obj).length == 11, "Got 11 keys in response" );
					
					for (var idx = 0; idx < 11; idx++) {
						test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
					}
					
					test.done();
				}
			);
		},
		
		function hashEachSyncAbort1(test) {
			// abort hashEach in the middle
			var self = this;
			var obj = {};
			var count = 0;
			
			this.storage.hashEachSync( 'hash1',
				function(key, value) {
					obj[key] = value;
					count++;
					if (count == 5) return false; // abort
				},
				function(err) {
					test.ok( !!err, "Error expected fetching hash each" );
					test.ok( err.message.toString().match(/abort/i), "Error message contains 'abort'" );
					test.ok( Object.keys(obj).length == 5, "Got 5 keys in response" );
					test.done();
				}
			);
		},
		
		// hashEachPage
		function hashEachPage1(test) {
			var self = this;
			var obj = {};
			
			this.storage.hashEachPage( 'hash1',
				function(data, callback) {
					test.ok( !!data, "Got data in page" );
					test.ok( Object.keys(data).length > 0, "At least one key in page" );
					
					for (var key in data) {
						test.ok( !(key in obj), "No duplicate key expected: " + key );
						obj[key] = data[key];
					}
					
					callback();
				},
				function(err) {
					test.ok( !err, "No error fetching hash page each: " + err );
					test.ok( Object.keys(obj).length == 11, "Got 11 keys in response" );
					
					for (var idx = 0; idx < 11; idx++) {
						test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
					}
					
					test.done();
				}
			);
		},
		
		// hashCopy
		function hashCopy1(test) {
			var self = this;
			
			this.storage.hashCopy( 'hash1', 'hashcopied', function(err) {
				// now make sure copied hash has everything we expect
				
				self.storage.hashGetAll( 'hashcopied', function(err, obj) {
					test.ok( !err, "No error fetching hashcopied all: " + err );
					test.ok( !!obj, "Got object in resopnse" );
					test.ok( Object.keys(obj).length == 11, "Got 11 hashcopied keys in response" );
					
					for (var idx = 0; idx < 11; idx++) {
						test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "hashcopied Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
					}
					
					test.done();
				});
			} );
		},
		
		// hashRename
		function hashRename1(test) {
			var self = this;
			
			this.storage.hashRename( 'hashcopied', 'hashrenamed', function(err) {
				// now make sure renamed hash has everything we expect
				
				self.storage.hashGetAll( 'hashrenamed', function(err, obj) {
					test.ok( !err, "No error fetching hashcopied all: " + err );
					test.ok( !!obj, "Got object in resopnse" );
					test.ok( Object.keys(obj).length == 11, "Got 11 hashcopied keys in response" );
					
					for (var idx = 0; idx < 11; idx++) {
						test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "hashcopied Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
					}
					
					// make sure original hash (hashcopied) is gone
					self.storage.get( 'hashcopied', function(err) {
						test.ok( !!err, "Error expected fetching head after deleting" );
						
						// clean up our mess
						self.storage.hashDeleteAll( 'hashrenamed', true, function(err) {
							test.done();
						});
					});
				});
			});
		},
		
		// hashDeleteMulti
		function hashDeleteMulti1(test) {
			var self = this;
			var keys = ['key1', 'key3', 'key5', 'key7', 'key9'];
			
			var even_keys = ['key0', 'key2', 'key4', 'key6', 'key8', 'key10'];
			var correct_evens = ["Value 0", "Value 2000", "Value 4000", "Value 6000", "Value 8000", "Value 10000"];
			
			this.storage.hashDeleteMulti( 'hash1', keys, function(err) {
				test.ok( !err, "No error deleting hash multi: " + err );
				// test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// this should fail (re-fetch odds)
				self.storage.hashGetMulti( 'hash1', keys, function(err, values) {
					test.ok( !!err, "Error expected fetching deleted keys" );
					
					// this should work tho (fetch evens)
					self.storage.hashGetMulti( 'hash1', even_keys, function(err, values) {
						test.ok( !err, "No error fetching even hash multi: " + err );
						test.ok( !!values, "Got values in response");
						test.ok( values.length == 6, "Values has correct length: " + values.length);
						
						correct_evens.forEach( function(value, idx) {
							test.ok( values[idx] == value, "Value correct for key: " + even_keys[idx] + ": " + values[idx]);
						} );
						
						test.done();
					});
				});
			});
		},
		
		// hashDeleteAll
		function hashDeleteAll1(test) {
			var self = this;
			
			this.storage.hashDeleteAll( 'hash1', true, function(err) {
				test.ok( !err, "No error deleting hash: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// make sure it is really deleted
				self.storage.get( 'hash1', function(err) {
					test.ok( !!err, "Error expected fetching head after deleting" );
					
					self.storage.get( 'hash1/data', function(err) {
						test.ok( !!err, "Error expected fetching data after deleting" );
						
						self.storage.get( 'hash1/data/0', function(err) {
							test.ok( !!err, "Error expected fetching page after deleting" );
							test.done();
						});
					});
				});
			});
		},
		
		// Deep multi put
		function hashPutMulti2(test) {
			// this will fill up and overflow many pages, going nested 2 levels deep
			var self = this;
			
			var obj = {};
			for (var idx = 0; idx < 150; idx++) {
				obj[ 'key'+idx ] = "Value " + Math.floor(idx * 1000);
			}
			
			this.storage.hashCreate( 'hash2', { page_size: 10 }, function(err, data) {
				test.ok( !err, "No error creating hash2: " + err );
				
				self.storage.hashPutMulti( 'hash2', obj, function(err) {
					test.ok( !err, "No error storing hash multikey: " + err );
					
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
							// check internals
							self.storage.get( 'hash2', function(err, hash) {
								test.ok( !err, "No error fetching hash header: " + err );
								test.ok( !!hash, "Got hash data from header key" );
								test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
								test.ok( hash.length == 150, "Hash length is 150: " + hash.length );
								test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
								
								self.storage.get( 'hash2/data', function(err, page) {
									test.ok( !err, "No error fetching hash page: " + err );
									test.ok( !!page, "Got hash page data" );
									test.ok( page.type == 'hash_index', "Page type is correct: " + page.type );
									test.ok( !page.items, "Page no longer contains items" );
									
									self.storage.get( 'hash2/data/0', function(err, page) {
										test.ok( !err, "No error fetching hash page: " + err );
										test.ok( !!page, "Got hash page data" );
										test.ok( page.type == 'hash_index', "Page type is correct: " + page.type );
										test.ok( !page.items, "Page no longer contains items" );
										
										self.storage.get( 'hash2/data/0/3', function(err, page) {
											test.ok( !err, "No error fetching nested hash page: " + err );
											test.ok( !!page, "Got nested hash page data" );
											test.ok( page.type == 'hash_page', "Nested page type is correct: " + page.type );
											test.ok( page.length == 1, "Nested page length is 1: " + page.length );
											test.ok( !!page.items, "Nested hash page has items" );
											test.ok( Object.keys(page.items).length == 1, "Nested hash page has 1 items" );
											
											// 'key101' has an MD5 that starts with '03', so we know it will be in hash2/data/0/3
											test.ok( page.items['key101'] == "Value 101000", "Nested hash page contains key101, and its value is correct" );
											test.done();
										} ); // hash2/data/0/3
									} ); // hash2/data/0
								} ); // hash2/data
							} ); // internals
						} // whilst complete
					); // whilst
				}); // hashPutMulti
			} ); // hashCreate
		},
		
		function hashGetAll2(test) {
			var self = this;
			
			this.storage.hashGetAll( 'hash2', function(err, obj) {
				test.ok( !err, "No error fetching hash all: " + err );
				test.ok( !!obj, "Got object in resopnse" );
				test.ok( Object.keys(obj).length == 150, "Got 150 keys in response" );
				
				for (var idx = 0; idx < 150; idx++) {
					test.ok( obj[ 'key'+idx ] == "Value " + Math.floor(idx * 1000), "Value correct for key: key"+idx+": " + obj[ 'key'+idx ] );
				}
				
				test.done();
			});
		},
		
		function hashDeleteAll2(test) {
			var self = this;
			
			this.storage.hashDeleteAll( 'hash2', true, function(err) {
				test.ok( !err, "No error deleting hash: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// make sure it is really deleted
				self.storage.get( 'hash2', function(err) {
					test.ok( !!err, "Error expected fetching head after deleting" );
					
					self.storage.get( 'hash2/data', function(err) {
						test.ok( !!err, "Error expected fetching data after deleting" );
						
						self.storage.get( 'hash2/data/0', function(err) {
							test.ok( !!err, "Error expected fetching page after deleting" );
							
							self.storage.get( 'hash2/data/0/3', function(err) {
								test.ok( !!err, "Error expected fetching page after deleting" );
								test.done();
							});
						});
					});
				});
			});
		},
		
		function hashUnsplit1(test) {
			// this will fill up and overflow a page into an index
			var self = this;
			
			var obj = {};
			for (var idx = 0; idx < 11; idx++) {
				obj[ 'key'+idx ] = "Value " + Math.floor(idx * 1000);
			}
			
			this.storage.hashPutMulti( 'hash3', obj, { page_size: 10 }, function(err) {
				test.ok( !err, "No error storing hash multikey: " + err );
				
				// key10 should trigger an async reindex, so we have to wait for that to complete
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
						// check internals
						self.storage.get( 'hash3', function(err, hash) {
							test.ok( !err, "No error fetching hash header: " + err );
							test.ok( !!hash, "Got hash data from header key" );
							test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
							test.ok( hash.length == 11, "Hash length is 11: " + hash.length );
							test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
							
							self.storage.get( 'hash3/data', function(err, page) {
								test.ok( !err, "No error fetching hash page: " + err );
								test.ok( !!page, "Got hash page data" );
								test.ok( page.type == 'hash_index', "Page type is correct: " + page.type );
								test.ok( !page.items, "Page no longer contains items" );
								
								self.storage.get( 'hash3/data/0', function(err, page) {
									test.ok( !err, "No error fetching nested hash page: " + err );
									test.ok( !!page, "Got nested hash page data" );
									test.ok( page.type == 'hash_page', "Nested page type is correct: " + page.type );
									test.ok( page.length == 1, "Nested page length is 1: " + page.length );
									test.ok( !!page.items, "Nested hash page has items" );
									test.ok( Object.keys(page.items).length == 1, "Nested hash page has 1 items" );
									
									// 'key9' has an MD5 that starts with '0', so we know it will be in hash1/data/0
									test.ok( page.items['key9'] == "Value 9000", "Nested hash page contains key9, and its value is correct" );
									test.done();
								} );
							} );
						} ); // internals
					} // idle
				); // whilst
			}); // hashPutMulti
		},
		
		function hashUnsplit2(test) {
			// delete all but one key, make sure we DIDN'T trigger an unsplit
			var self = this;
			
			var keys = [];
			for (var idx = 0; idx < 10; idx++) {
				keys.push( 'key'+idx );
			}
			
			this.storage.hashDeleteMulti( 'hash3', keys, function(err) {
				test.ok( !err, "No error deleting hash multi: " + err );
				
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
						// check internals
						self.storage.get( 'hash3', function(err, hash) {
							test.ok( !err, "No error fetching hash header: " + err );
							test.ok( !!hash, "Got hash data from header key" );
							test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
							test.ok( hash.length == 1, "Hash length is 1: " + hash.length );
							test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
							
							self.storage.get( 'hash3/data/f', function(err, page) {
								test.ok( !err, "No error fetching nested hash page: " + err );
								test.ok( !!page, "Got nested hash page data" );
								test.ok( page.type == 'hash_page', "Nested page type is correct: " + page.type );
								test.ok( page.length == 1, "Nested page length is 1: " + page.length );
								test.ok( !!page.items, "Nested hash page has items" );
								test.ok( Object.keys(page.items).length == 1, "Nested hash page has 1 items" );
								
								// 'key10' has an MD5 that starts with 'f', so we know it will be in hash3/data/f
								test.ok( page.items['key10'] == "Value 10000", "Nested hash page contains key10, and its value is correct" );
								test.done();
							} );
						} );
					} // whilst done
				); // async.whilst
			}); // hashDeleteMulti
		},
		
		function hashUnsplit3(test) {
			// delete final key, triggering an unsplit
			var self = this;
			
			this.storage.hashDeleteMulti( 'hash3', ['key10'], function(err) {
				test.ok( !err, "No error deleting key10: " + err );
				
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
						// check internals
						self.storage.get( 'hash3', function(err, hash) {
							test.ok( !err, "No error fetching hash header: " + err );
							test.ok( !!hash, "Got hash data from header key" );
							test.ok( hash.type == 'hash', "Data type is hash: " + hash.type );
							test.ok( hash.length == 0, "Hash length is 0: " + hash.length );
							test.ok( hash.page_size > 0, "Hash page_size is non-zero: " + hash.page_size );
							
							self.storage.get( 'hash3/data', function(err, page) {
								test.ok( !err, "No error fetching nested hash page: " + err );
								test.ok( !!page, "Got nested hash page data" );
								test.ok( page.type == 'hash_page', "Nested page type is correct: " + page.type );
								test.ok( page.length == 0, "Nested page length is 0: " + page.length );
								test.ok( !!page.items, "Nested hash page has items" );
								test.ok( Object.keys(page.items).length == 0, "Nested hash page has 0 items" );
								
								self.storage.get( 'hash3/data/f', function(err, page) {
									test.ok( !!err, "Error expected fetching deleted hash page: " + err );
									
									// finally, delete hash
									self.storage.hashDeleteAll( 'hash3', true, function(err) {
										test.ok( !err, "No error deleting hash3: " + err );
										test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
										test.done();
									});
								} );
							} );
						} );
					} // whilst done
				); // async.whilst
			}); // hashDeleteMulti
		},
		
		function hashBadCreate(test) {
			// create hash we can use to test bad keys
			// this is designed to overflow (reindex) when all 12+ keys are added
			var self = this;
			
			this.storage.hashCreate( 'hashbad', { page_size: 10 }, function(err) {
				test.ok( !err, "Error creating hashbad: " + err );
				
				// put one normal (control) key in hash
				self.storage.hashPut( 'hashbad', 'control', 1, function(err) {
					test.ok( !err, "Got error putting control key: " + err );
					test.done();
				});
			} );
		},
		
		function hashGetBadKeysBefore(test) {
			// pre-fetch bad keys, make sure they do not exist in our empty hash
			var self = this;
			
			async.eachSeries( BAD_KEYS,
				function(key, callback) {
					self.storage.hashGet( 'hashbad', key, function(err, value) {
						test.ok( !!err, "No error fetching non-existent bad key: " + key );
						test.ok( !value, "Unexpected value fetching non-existent bad key: " + key + ": " + value );
						callback();
					} );
				},
				function(err) {
					test.done();
				}
			); // async.eachSeries
		},
		
		function hashPutBadKeys(test) {
			// put bad (toxic) keys in hash (Object.prototype stuff)
			// this should also trigger a reindex
			var self = this;
			
			async.eachSeries( BAD_KEYS,
				function(key, callback) {
					self.storage.hashPut( 'hashbad', key, 42, callback );
				},
				function(err) {
					test.ok( !err, "Got error putting bad keys: " + err );
					test.done();
				}
			); // async.eachSeries
		},
		
		function hashGetBadKeys(test) {
			// get bad keys in hash (Object.prototype stuff)
			// these should all succeed
			var self = this;
			
			async.eachSeries( BAD_KEYS,
				function(key, callback) {
					self.storage.hashGet( 'hashbad', key, function(err, value) {
						test.ok( !err, "Got error fetching bad key: " + key + ": " + err );
						test.ok( value == 42, "Unexpected value fetching bad key: " + key + ": " + value );
						callback();
					} );
				},
				function(err) {
					// make sure our control key is still there as well
					self.storage.hashGet( 'hashbad', 'control', function(err, value) {
						test.ok( !err, "Got error fetching control key: " + err );
						test.ok( value == 1, "Unexpected value fetching control key: " + value );
						test.done();
					});
				}
			); // async.eachSeries
		},
		
		function hashBadGetAll(test) {
			// fetch bad hash with hashGetAll() API
			this.storage.hashGetAll( 'hashbad', function(err, hash) {
				test.ok( !err, "Unexpected error fetching all bad: " + err );
				
				BAD_KEYS.forEach( function(key) {
					test.ok( hash[key] === 42, "(hashGetAll) Unexpected key value: " + key + ": " + hash[key] );
				});
				
				test.ok( hash.control == 1, "Expected control key to equal 1, got: " + hash.control );
				test.done();
			});
		},
		
		function hashBadEach(test) {
			// iterate over hash with bad keys
			var self = this;
			var found = [];
			
			this.storage.hashEach( 'hashbad', function(key, value, callback) {
				// do something with key/value
				found.push( key );
				process.nextTick( callback );
			}, 
			function(err) {
				// all keys iterated over
				test.ok( !err, "Got error async-iterating over bad hash: " + err );
				
				// we should have exactly BAD_KEYS + 1 keys
				test.ok( found.length == (BAD_KEYS.length + 1), "Unexpected found length: " + found.length );
				
				// make sure we have all the expected keys
				BAD_KEYS.forEach( function(key) {
					test.ok( !!found.includes(key), "Expected key not in found array: " + key );
				});
				
				// we should have the control key too
				test.ok( found.includes('control'), "Expected control key not in found array" );
				
				test.done();
			} );
		},
		
		function hashBadEachSync(test) {
			// iterate over hash with bad keys (sync)
			var self = this;
			var found = [];
			
			this.storage.hashEachSync( 'hashbad', function(key, value) {
				// do something with key/value
				found.push( key );
			}, 
			function(err) {
				// all keys iterated over
				test.ok( !err, "Got error sync-iterating over bad hash: " + err );
				
				// we should have exactly BAD_KEYS + 1 keys
				test.ok( found.length == (BAD_KEYS.length + 1), "Unexpected found length: " + found.length );
				
				// make sure we have all the expected keys
				BAD_KEYS.forEach( function(key) {
					test.ok( !!found.includes(key), "Expected key not in found array: " + key );
				});
				
				// we should have the control key too
				test.ok( found.includes('control'), "Expected control key not in found array" );
				
				test.done();
			} );
		},
		
		function hashBadDelete(test) {
			// delete individual keys so we trigger an unsplit
			var self = this;
			
			this.storage.hashDeleteMulti( 'hashbad', BAD_KEYS, function(err) {
				test.ok( !err, "Got error multi-deleting bad hash: " + err );
				
				// at this point only the control key should remain
				self.storage.hashGetAll( 'hashbad', function(err, hash) {
					test.ok( !err, "Unexpected error fetching all bad: " + err );
					test.ok( Tools.numKeys(hash) == 1, "Expected only 1 key in hash, got: " + JSON.stringify(hash) );
					test.ok( hash.control == 1, "Expected control key to equal 1, got: " + hash.control );
					test.done();
				});
			});
		},
		
		function hashBadDeleteAll(test) {
			// cleanup
			var self = this;
			
			this.storage.hashDeleteAll( 'hashbad', true, function(err) {
				test.ok( !err, "No error deleting hashbad: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				
				// make sure it is really deleted
				self.storage.get( 'hashbad', function(err) {
					test.ok( !!err, "Error expected fetching head after deleting" );
					
					self.storage.get( 'hashbad/data', function(err) {
						test.ok( !!err, "Error expected fetching data after deleting" );
						test.done();
					});
				});
			});
		}
		
	] // tests array
};
