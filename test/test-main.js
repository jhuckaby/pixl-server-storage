// Unit tests for Storage System - Main
// Copyright (c) 2015 - 2016 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');
var async = require('async');

var digestHex = function(str) {
	// digest string using SHA256, return hex hash
	var shasum = crypto.createHash('sha256');
	shasum.update( str );
	return shasum.digest('hex');
};

module.exports = {
	tests: [
	
		/* function test1(test) {
			test.ok(true, 'bar');
			test.done();
		}, */
		
		/* function test2(test) {
			test.ok(false, 'bar THIS SHOULD FAILZZZZ');
			test.done();
		}, */
		
		function put1(test) {
			test.expect(1);
			this.storage.put( 'test1', { foo: 'bar1' }, function(err) {
				test.ok( !err, "No error creating test1: " + err );
				test.done();
			} );
		},
		
		function get1(test) {
			test.expect(3);
			this.storage.get( 'test1', function(err, data) {
				test.ok( !err, "No error fetching test1: " + err );
				test.ok( !!data, "Data is true" );
				test.ok( data.foo == 'bar1', "Value is correct" );
				test.done();
			} );
		},
		
		function setExp1(test) {
			var self = this;
			test.expect(1);
			this.storage.put( 'test_expire', { foo: 'delete me!' }, function(err) {
				test.ok( !err, "No error creating test_expire: " + err );
				var exp_date = Math.floor( (new Date()).getTime() / 1000 );
				self.storage.expire( 'test_expire', exp_date, true );
				
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
						// locks / queue are free, proceed
						test.done();
					} // whilst complete
				); // whilst
			} );
		},
		
		function head1(test) {
			test.expect(4);
			this.storage.head( 'test1', function(err, meta) {
				test.ok( !err, "No error heading test1: " + err );
				test.ok( !!meta, "Meta is true" );
				test.ok( meta.len > 0, "Length is non-zero" );
				test.ok( meta.mod > 0, "Mod is non-zero" );
				test.done();
			} );
		},
		
		function headFail1(test) {
			test.expect(2);
			this.storage.head( 'test_NO_EXIST', function(err, meta) {
				test.ok( !!err, "Error expected heading non-existent key" );
				test.ok( !meta, "Meta expected to be false" );
				test.done();
			} );
		},
		
		function getFail1(test) {
			test.expect(2);
			this.storage.get( 'test_NO_EXIST', function(err, data) {
				test.ok( !!err, "Error expected getting non-existent key" );
				test.ok( !data, "Data expected to be false" );
				test.done();
			} );
		},
		
		function replace1(test) {
			var self = this;
			test.expect(4);
			
			this.storage.put( 'test1', { foo: 'bar2' }, function(err) {
				test.ok( !err, "No error updating test1: " + err );
				
				self.storage.get( 'test1', function(err, data) {
					test.ok( !err, "No error fetching test1 after replace: " + err );
					test.ok( !!data, "Data is true afer replace" );
					test.ok( data.foo == 'bar2', "Value is correct after replace" );
					test.done();
				} );
			} );
		},
		
		function copy1(test) {
			var self = this;
			test.expect(8);
			
			this.storage.copy( 'test1', 'test2', function(err) {
				test.ok( !err, "No error copying test1: " + err );
				
				self.storage.get( 'test1', function(err, data) {
					test.ok( !err, "No error fetching test1 after copy: " + err );
					test.ok( !!data, "Old data is true afer copy" );
					test.ok( data.foo == 'bar2', "Old value is correct after copy" );
					
					self.storage.get( 'test2', function(err, data) {
						test.ok( !err, "No error fetching test2 after copy: " + err );
						test.ok( !!data, "Data is true afer copy" );
						test.ok( data.foo == 'bar2', "Value is correct after copy" );
						
						self.storage.delete( 'test2', function(err) {
							test.ok( !err, "No error deleting test2 after copy: " + err );
							test.done();
						} );
					} );
				} );
			} );
		},
		
		function rename1(test) {
			var self = this;
			test.expect(6);
			
			this.storage.rename( 'test1', 'test3', function(err) {
				test.ok( !err, "No error copying test1: " + err );
				
				self.storage.get( 'test1', function(err, data) {
					test.ok( !!err, "Error expected fetching test1 after rename" );
					test.ok( !data, "Old data expected to be false after rename" );
					
					self.storage.get( 'test3', function(err, data) {
						test.ok( !err, "No error fetching test3 after rename: " + err );
						test.ok( !!data, "Data is true afer rename" );
						test.ok( data.foo == 'bar2', "Value is correct after rename" );
						test.done();
					} );
				} );
			} );
		},
		
		function delete1(test) {
			var self = this;
			test.expect(3);
			
			this.storage.delete( 'test3', function(err) {
				test.ok( !err, "No error deleting test3: " + err );
				
				self.storage.get( 'test3', function(err, data) {
					test.ok( !!err, "Error expected fetching test1 after delete" );
					test.ok( !data, "Data expected to be false after delete" );
					test.done();
				} );
			} );
		},
		
		function testLocking(test) {
			// test advisory locking
			var self = this;
			var key = 'test-lock';
			var storage = this.storage;
			test.expect( 28 );
			
			test.ok( Object.keys(self.storage.locks).length == 0, "No locks at start of test" );
			
			storage.put( key, { foo:"hello", counter:0 }, function(err) {
				test.ok( !err, "No error putting lock key: " + err );
				
				async.times( 10,
					function(idx, callback) {
						
						storage.lock( key, true, function() {
							storage.get( key, function(err, data) {
								test.ok( !err, "No error fetching lock key: " + err );
								
								data.counter++;
								
								storage.put( key, data, function(err) {
									test.ok( !err, "No error updating lock key: " + err );
									
									storage.unlock(key);
									callback();
								} ); // put
							} ); // get
						} ); // lock
						
					}, // iterator
					function(err) {
						// all done, now fetch and check counter
						test.ok( !err, "No error at end of lock async.times: " + err );
						
						storage.get( key, function(err, data) {
							test.ok( !err, "No error fetching lock key last time: " + err );
							test.ok( !!data, "Got data from lock key" );
							test.ok( data.counter == 10, "Correct counter value after async lock update: " + data.counter );
							test.ok( Object.keys(storage.locks).length == 0, "No more locks leftover in storage" );
							
							storage.delete( key, function(err) {
								test.ok( !err, "No error deleting lock key: " + err );
								test.done();
							} );
						} );
					} // completion
				);
			} );
		},
		
		function testSharedLocking(test) {
			// test shared locking
			var self = this;
			var key = 'test-lock';
			var storage = this.storage;
			
			test.expect( 19 );
			test.ok( Object.keys(storage.locks).length == 0, "No locks at start of test" );
			
			storage.lock( key, true, function(err, lock) {
				// got exclusive lock
				test.ok( lock.type == 'ex', "Expected exclusive lock type: " + lock.type);
				
				setTimeout( function() {
					// unlocking exclusive
					test.ok( lock.type == 'ex', "Expected exclusive lock type: " + lock.type);
					test.ok( lock.clients.length == 3, "Expected 3 waiting clients: " + lock.clients.length);
					test.ok( !lock.readers, "No readers expected here: " + lock.readers);
					
					storage.unlock( key );
				}, 100 );
			} );
			
			setTimeout( function() {
				async.times( 3, 
					function(idx, callback) {
						storage.shareLock( key, true, function(err, lock) {
							// got shared lock
							test.ok( lock.type == 'sh', "Expected shared lock type: " + lock.type);
							
							setTimeout( function() {
								storage.shareUnlock( key );
								callback();
							}, 100 );
						} );
					},
					function(err) {
						// async.times complete
					}
				);
			}, 50 );
			
			setTimeout( function() {
				// at this point, all 3 shared locks should be active
				var lock = storage.locks[key];
				test.ok( !!lock, "Got expected lock record" );
				test.ok( lock.type == 'sh', "Expected shared lock type: " + lock.type);
				test.ok( lock.readers == 3, "Expected 3 readers: " + lock.readers);
				
				var got_ex_lock = false;
				
				storage.lock( key, true, function(err, lock) {
					// got exclusive lock again
					test.ok( lock.type == 'ex', "Expected exclusive lock type: " + lock.type);
					got_ex_lock = true;
					
					setTimeout( function() {
						// unlocking exclusive AGAIN
						test.ok( lock.type == 'ex', "Expected exclusive lock type: " + lock.type);
						test.ok( lock.clients.length == 3, "Expected 3 waiting clients: " + lock.clients.length);
						test.ok( !lock.readers, "No readers expected here: " + lock.readers);
						
						storage.unlock( key );
					}, 100 ); // setTimeout
				} ); // lock
				
				setTimeout( function() {
					async.times( 3, 
						function(idx, callback) {
							storage.shareLock( key, true, function(err, lock) {
								// got shared lock AGAIN
								test.ok( got_ex_lock, "Got exclusive lock before second shared lock" );
								
								setTimeout( function() {
									storage.shareUnlock( key );
									callback();
								}, 100 );
							} );
						},
						function(err) {
							// async.times complete again
							test.ok( Object.keys(storage.locks).length == 0, "No more locks leftover in storage" );
							test.done();
						}
					); // async.times
				}, 25 ); // setTimeout (inner)
			}, 150 ); // setTimeout (outer)
		},
		
		function testKeyNormalization(test) {
			test.expect(6);
			var self = this;
			var key1 = ' / / / // HELLO-KEY @*#&^$*@/#&^$(*@#&^$   test   / ';
			var key2 = 'hello-key/test';
			
			this.storage.put( key1, { foo: 9876 }, function(err) {
				test.ok( !err, "No error creating weird key: " + err );
				
				self.storage.get( key2, function(err, data) {
					test.ok( !err, "No error fetching weird key: " + err );
					test.ok( !!data, "Data is true" );
					test.ok( typeof(data) == 'object', "Data is an object (not a string)" );
					test.ok( data.foo == 9876, "Data contains expected key and value" );
					
					self.storage.delete( key1, function(err) {
						test.ok( !err, "No error deleting weird key: " + err );
						test.done();
					} );
				} );
			} );
		},
		
		function testBinary(test) {
			test.expect(10);
			var self = this;
			var key = 'spacer.gif';
			var spacerBuf = fs.readFileSync( __dirname + '/' + key );
			var spacerHash = digestHex( spacerBuf );
			
			test.ok( !!spacerBuf, "Got buffer from file" );
			test.ok( typeof(spacerBuf) == 'object', "Buffer is an object" );
			test.ok( spacerBuf.length > 0, "Buffer has size" );
			
			this.storage.put( key, spacerBuf, function(err) {
				test.ok( !err, "No error creating binary: " + err );
				
				self.storage.get( key, function(err, data) {
					test.ok( !err, "No error fetching binary: " + err );
					test.ok( !!data, "Data is true" );
					test.ok( typeof(data) == 'object', "Data is an object (not a string)" );
					test.ok( data.length == spacerBuf.length, "Data length is correct" );
					
					var hashTest = digestHex( data );
					test.ok( hashTest == spacerHash, "SHA256 hash of data matches original" );
					
					self.storage.delete( key, function(err) {
						test.ok( !err, "No error deleting binary key: " + err );
						test.done();
					} );
				} );
			} );
		},
		
		function testBuffer(test) {
			test.expect(8);
			var self = this;
			var key = 'buftest';
			var value = { buf: "test" };
			
			this.storage.put( key, value, function(err) {
				test.ok( !err, "No error creating buftest: " + err );
				
				self.storage.getBuffer( key, function(err, data) {
					test.ok( !err, "No error fetching binary: " + err );
					test.ok( !!data, "Data is true" );
					test.ok( typeof(data) == 'object', "Data is an object (not a string)" );
					test.ok( data.length > 0, "Data length is non-zero" );
					
					var json = JSON.parse( data.toString() );
					test.ok( !!json, "Parsed JSON object from buftest" );
					test.ok( json.buf === "test", "Correct data inside JSON buftest" );
					
					self.storage.delete( key, function(err) {
						test.ok( !err, "No error deleting buftest key: " + err );
						test.done();
					} );
				} );
			} );
		},
		
		function testStream(test) {
			test.expect(14);
			var self = this;
			
			var key = 'spacer-stream.gif';
			var filename = 'spacer.gif';
			var spacerBuf = fs.readFileSync( __dirname + '/' + filename );
			var spacerHash = digestHex( spacerBuf );
			var spacerStream = fs.createReadStream( __dirname + '/' + filename );
			
			test.ok( !!spacerBuf, "Got buffer from file" );
			test.ok( typeof(spacerBuf) == 'object', "Buffer is an object" );
			test.ok( spacerBuf.length > 0, "Buffer has size" );
			test.ok( !!spacerStream, "Got read stream" );
			
			this.storage.putStream( key, spacerStream, function(err) {
				test.ok( !err, "No error creating stream: " + err );
				
				var tempFile = __dirname + '/' + filename + '.streamtemp';
				var outStream = fs.createWriteStream( tempFile );
				
				self.storage.getStream( key, function(err, storageStream, streamInfo) {
					test.ok( !err, "No error fetching stream: " + err );
					test.ok( !!storageStream, "Got storage stream as 2nd arg");
					test.ok( !!storageStream.pipe, "Storage stream has a pipe");
					test.ok( !!streamInfo, "Info was provided as the 3rd arg");
					test.ok( streamInfo.len == 43, "Info has correct data length");
					test.ok( streamInfo.mod > 0, "Info has a non-zero mod date");
					
					outStream.on('finish', function() {
						var newSpacerBuf = fs.readFileSync( tempFile );
						test.ok( newSpacerBuf.length == spacerBuf.length, "Stream length is correct" );
						
						var hashTest = digestHex( newSpacerBuf );
						test.ok( hashTest == spacerHash, "SHA256 hash of data matches original" );
						
						self.storage.delete( key, function(err) {
							test.ok( !err, "No error deleting stream key: " + err );
							fs.unlinkSync( tempFile );
							test.done();
						} ); // delete
					} ); // stream finish
					
					storageStream.pipe( outStream );
					
				} ); // getStream
			} ); // putStream
		},
		
		function testStreamRange(test) {
			// grab a range from within a stream, with both start and end specified
			test.expect(14);
			var self = this;
			
			var key = 'spacer-stream.gif';
			var filename = 'spacer.gif';
			var spacerBuf = fs.readFileSync( __dirname + '/' + filename );
			var spacerStream = fs.createReadStream( __dirname + '/' + filename );
			
			test.ok( !!spacerBuf, "Got buffer from file" );
			test.ok( typeof(spacerBuf) == 'object', "Buffer is an object" );
			test.ok( spacerBuf.length > 0, "Buffer has size" );
			test.ok( !!spacerStream, "Got read stream" );
			
			this.storage.putStream( key, spacerStream, function(err) {
				test.ok( !err, "No error creating stream: " + err );
				
				var tempFile = __dirname + '/' + filename + '.streamtemp';
				var outStream = fs.createWriteStream( tempFile );
				
				self.storage.getStreamRange( key, 0, 5, function(err, storageStream, streamInfo) {
					test.ok( !err, "No error fetching stream: " + err );
					test.debug( "streamInfo: ", streamInfo );
					test.ok( !!storageStream, "Got storage stream as 2nd arg");
					test.ok( !!storageStream.pipe, "Storage stream has a pipe");
					test.ok( !!streamInfo, "Info was provided as the 3rd arg");
					test.ok( streamInfo.len == 43, "Info has correct data length (expected 43, got " + streamInfo.len + ")");
					test.ok( streamInfo.mod > 0, "Info has a non-zero mod date");
					
					outStream.on('finish', function() {
						var newSpacerBuf = fs.readFileSync( tempFile );
						test.ok( newSpacerBuf.length == 6, "Stream length is correct" );
						test.ok( newSpacerBuf.toString() == "GIF89a", "Range buffer content is correct" );
						
						self.storage.delete( key, function(err) {
							test.ok( !err, "No error deleting stream key: " + err );
							fs.unlinkSync( tempFile );
							test.done();
						} ); // delete
					} ); // stream finish
					
					storageStream.pipe( outStream );
					
				} ); // getStream
			} ); // putStream
		},
		
		function testStreamRangeStart(test) {
			// grab a range from within a stream, with end missing
			test.expect(14);
			var self = this;
			
			var key = 'spacer-stream.gif';
			var filename = 'spacer.gif';
			var spacerBuf = fs.readFileSync( __dirname + '/' + filename );
			var spacerStream = fs.createReadStream( __dirname + '/' + filename );
			
			test.ok( !!spacerBuf, "Got buffer from file" );
			test.ok( typeof(spacerBuf) == 'object', "Buffer is an object" );
			test.ok( spacerBuf.length > 0, "Buffer has size" );
			test.ok( !!spacerStream, "Got read stream" );
			
			this.storage.putStream( key, spacerStream, function(err) {
				test.ok( !err, "No error creating stream: " + err );
				
				var tempFile = __dirname + '/' + filename + '.streamtemp';
				var outStream = fs.createWriteStream( tempFile );
				
				self.storage.getStreamRange( key, 20, NaN, function(err, storageStream, streamInfo) {
					test.ok( !err, "No error fetching stream: " + err );
					test.ok( !!storageStream, "Got storage stream as 2nd arg");
					test.ok( !!storageStream.pipe, "Storage stream has a pipe");
					test.ok( !!streamInfo, "Info was provided as the 3rd arg");
					test.ok( streamInfo.len == 43, "Info has correct data length (expected 43, got " + streamInfo.len + ")");
					test.ok( streamInfo.mod > 0, "Info has a non-zero mod date");
					
					outStream.on('finish', function() {
						var newSpacerBuf = fs.readFileSync( tempFile );
						test.ok( newSpacerBuf.length == 23, "Stream range length is correct" );
						test.ok( newSpacerBuf.equals( spacerBuf.slice(20) ), "Range buffer content is correct" );
						
						self.storage.delete( key, function(err) {
							test.ok( !err, "No error deleting stream key: " + err );
							fs.unlinkSync( tempFile );
							test.done();
						} ); // delete
					} ); // stream finish
					
					storageStream.pipe( outStream );
					
				} ); // getStream
			} ); // putStream
		},
		
		function testStreamRangeEnd(test) {
			// grab a range from within a stream, with start missing
			test.expect(14);
			var self = this;
			
			var key = 'spacer-stream.gif';
			var filename = 'spacer.gif';
			var spacerBuf = fs.readFileSync( __dirname + '/' + filename );
			var spacerStream = fs.createReadStream( __dirname + '/' + filename );
			
			test.ok( !!spacerBuf, "Got buffer from file" );
			test.ok( typeof(spacerBuf) == 'object', "Buffer is an object" );
			test.ok( spacerBuf.length > 0, "Buffer has size" );
			test.ok( !!spacerStream, "Got read stream" );
			
			this.storage.putStream( key, spacerStream, function(err) {
				test.ok( !err, "No error creating stream: " + err );
				
				var tempFile = __dirname + '/' + filename + '.streamtemp';
				var outStream = fs.createWriteStream( tempFile );
				
				self.storage.getStreamRange( key, NaN, 10, function(err, storageStream, streamInfo) {
					test.ok( !err, "No error fetching stream: " + err );
					test.ok( !!storageStream, "Got storage stream as 2nd arg");
					test.ok( !!storageStream.pipe, "Storage stream has a pipe");
					test.ok( !!streamInfo, "Info was provided as the 3rd arg");
					test.ok( streamInfo.len == 43, "Info has correct data length (expected 43, got " + streamInfo.len + ")");
					test.ok( streamInfo.mod > 0, "Info has a non-zero mod date");
					
					outStream.on('finish', function() {
						var newSpacerBuf = fs.readFileSync( tempFile );
						test.ok( newSpacerBuf.length == 10, "Stream range length is correct" );
						test.ok( newSpacerBuf.equals( spacerBuf.slice(43 - 10) ), "Range buffer content is correct" );
						
						self.storage.delete( key, function(err) {
							test.ok( !err, "No error deleting stream key: " + err );
							fs.unlinkSync( tempFile );
							test.done();
						} ); // delete
					} ); // stream finish
					
					storageStream.pipe( outStream );
					
				} ); // getStream
			} ); // putStream
		},
		
		function testPutMulti(test) {
			// test storing multiple keys at once
			test.expect(1);
			var keys = ['multi1', 'multi2', 'multi3'];
			var records = {
				multi1: { fruit: 'apple' },
				multi2: { fruit: 'orange' },
				multi3: { fruit: 'banana' }
			};
			this.storage.putMulti( records, function(err) {
				test.ok( !err, "No error calling putMulti: " + err );
				test.done();
			} );
		},
		
		function testGetMulti(test) {
			// test getMulti using several keys
			test.expect(6);
			var keys = ['multi1', 'multi2', 'multi3'];
			
			this.storage.getMulti( keys, function(err, values) {
				test.ok( !err, "No error calling getMulti: " + err );
				test.ok( !!values, "Got values from getMulti" );
				test.ok( values.length == 3, "Got 3 values from getMulti" );
				test.ok( values[0].fruit == 'apple', "First fruit is apple" );
				test.ok( values[1].fruit == 'orange', "Second fruit is orange" );
				test.ok( values[2].fruit == 'banana', "Third fruit is banana" );
				test.done();
			} );
		},
		
		function testHeadMulti(test) {
			// test headMulti using several keys
			test.expect(6);
			var keys = ['multi1', 'multi2', 'multi3'];
			
			this.storage.headMulti( keys, function(err, values) {
				test.ok( !err, "No error calling headMulti: " + err );
				test.ok( !!values, "Got values from headMulti" );
				test.ok( values.length == 3, "Got 3 values from headMulti" );
				test.ok( !!values[0].mod, "First metadata has a positive mod date" );
				test.ok( !!values[1].mod, "Second metadata has a positive mod date" );
				test.ok( !!values[2].mod, "Third metadata has a positive mod date" );
				test.done();
			} );
		},
		
		function testDeleteMulti(test) {
			// delete multiple keys at once using deleteMulti
			test.expect(2);
			var self = this;
			var keys = ['multi1', 'multi2', 'multi3'];
			
			this.storage.deleteMulti( keys, function(err) {
				test.ok( !err, "No error calling deleteMulti: " + err );
				
				// make sure they're really gone
				self.storage.getMulti( keys, function(err, values) {
					test.ok( !!err, "Expected error calling getMulti after delete" );
					test.done();
				} );
			} );
		},
		
		function testMaintenance(test) {
			var self = this;
			test.expect(3);
			
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
					// locks / queue are free, proceed
					self.storage.runMaintenance( new Date(), function(err) {
						test.ok( !err, "No error running maintenance: " + err );
						
						self.storage.get( 'test_expire', function(err, data) {
							test.ok( !!err, "Error expected getting test_expire, should be deleted" );
							test.ok( !data, "Data expected to be false" );
							test.done();
						} );
					} );
				} // whilst complete
			); // whilst
		},
		
		function maintCleanup(test) {
			// cleanup leftover hash from expiration system
			this.storage.hashDeleteAll( '_cleanup/expires', true, function(err) {
				test.ok( !err, "No error deleting cleanup hash: " + err );
				test.done();
			} );
		}
		
	] // tests array
};
