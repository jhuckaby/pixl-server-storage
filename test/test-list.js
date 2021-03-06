// Unit tests for Storage System - List
// Copyright (c) 2015 - 2016 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');
var Tools = require('pixl-tools');

module.exports = {
	tests: [
	
		function listCreate1(test) {
			test.expect(1);
			this.storage.listCreate( 'list1', {}, function(err, data) {
				test.ok( !err, "No error creating list1: " + err );
				test.done();
			} );
		},
		
		function listGetEmpty1(test) {
			test.expect(2);
			this.storage.listGet( 'list1', 0, 0, function(err, items) {
				test.ok( !!items, "Expected array for empty list" );
				test.ok( !items.length, "Expected zero length in items array on empty list" );
				test.done();
			} );
		},
		
		function listPush1(test) {
			var self = this;
			test.expect(2);
			this.storage.listPush( 'list1', { foo: 'bar', number: 123 }, function(err, data) {
				test.ok( !err, "No error pushing onto list: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function listGet1(test) {
			var self = this;
			test.expect(16);
			this.storage.listGet( 'list1', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1, "List has 1 item: " + items.length );
				test.ok( items[0].foo == 'bar', "List item value matches" );
				
				// check internals
				self.storage.get( 'list1', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 1, "List length is 1: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list1/0', function(err, page) {
						test.ok( !err, "No error fetching list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
						test.done();
					} );
				} ); // internals
			} );
		},
		
		function listPop1(test) {
			var self = this;
			test.expect(4);
			this.storage.listPop( 'list1', function(err, item) {
				test.ok( !err, "No error popping list: " + err );
				test.ok( !!item, "Item is true" );
				test.ok( item.foo == 'bar', "List popped item value matches" );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function listGetEmpty2(test) {
			var self = this;
			test.expect(15);
			this.storage.listGet( 'list1', 0, 0, function(err, items) {
				test.ok( !err, "No error expected getting empty list again" );
				test.ok( !!items, "Expected array for empty list" );
				test.ok( !items.length, "Expected zero length in items array on empty list" );
				
				// check internals
				self.storage.get( 'list1', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 0, "List length is 0: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list1/0', function(err, page) {
						test.ok( !err, "No error fetching list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 0, "List page has 0 items: " + page.items.length );
						test.done();
					} );
				} ); // internals
			} );
		},
		
		function listPush2(test) {
			var self = this;
			test.expect(13);
			this.storage.listPush( 'list1', { foo: 'bar2', number: 124 }, function(err, data) {
				test.ok( !err, "No error pushing list again: " + err );
				
				// check internals
				self.storage.get( 'list1', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 1, "List length is 1: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list1/0', function(err, page) {
						test.ok( !err, "No error fetching list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
						test.done();
					} );
				} ); // internals
			} );
		},
		
		function listDelete1(test) {
			var self = this;
			test.expect(2);
			this.storage.listDelete( 'list1', true, function(err, data) {
				test.ok( !err, "No error deleting list: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function listGetEmpty3(test) {
			test.expect(1);
			this.storage.listGet( 'list1', 0, 0, function(err, items) {
				test.ok( !!err, "Error expected getting deleted list" );
				test.done();
			} );
		},
		
		function listGetInfoEmpty1(test) {
			var self = this;
			test.expect(3);
			this.storage.listGetInfo( 'list1', function(err, list) {
				test.ok( !!err, "Error expected getting list info after delete" );
				
				// check internals
				self.storage.get( 'list1', function(err, list) {
					test.ok( !!err, "Error expected fetching list header: " + err );
					
					self.storage.get( 'list1/0', function(err, page) {
						test.ok( !!err, "Error expected fetching list page: " + err );
						test.done();
					} );
				} ); // internals
			} );
		},
		
		function listCreate2(test) {
			test.expect(1);
			this.storage.listCreate( 'list2', {}, function(err, data) {
				test.ok( !err, "No error creating list2: " + err );
				test.done();
			} );
		},
				
		function listPushMulti1(test) {
			var self = this;
			var idx = 0;
			test.expect(1);
			
			async.whilst(
				function() { return idx < 10; },
				function(callback) {
					self.storage.listPush( 'list2', { foo: 'bar', number: idx++ }, function(err, data) {
						callback(err);
					} );
				},
				function(err) {
					test.ok( !err, "No error pushing items to list: " + err );
					test.done();
				}
			);
		},
		
		function listGetMulti1(test) {
			test.expect(4);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list2: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 10, "List has 10 items: " + items.length );
				test.ok( items[5].number == 5, "List item 5 value matches" );
				test.done();
			} );
		},
		
		function listGetInfo1(test) {
			test.expect(2);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after multi-push: " + err );
				test.ok( list.first_page == list.last_page, "First page and last page are the same" );
				test.done();
			} );
		},
		
		function listPushNewPage1(test) {
			// This push should create a new page
			test.expect(1);
			this.storage.listPush( 'list2', { foo: 'bar', number: 10 }, function(err, data) {
				test.ok( !err, "No error pushing new page onto list: " + err );
				test.done();
			} );
		},
		
		function listGetMulti2(test) {
			test.expect(4);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list2: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 11, "List has 11 items: " + items.length );
				test.ok( items[5].number == 5, "List item 5 value matches" );
				test.done();
			} );
		},
		
		function listGetCrossPage1(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 9, 2, function(err, items) {
				test.ok( !err, "No error fetching list2(9,2): " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 2, "List has 2 items: " + items.length );
				test.ok( items[0].number == 9, "List item 0 value matches" );
				test.ok( items[1].number == 10, "List item 1 value matches" );
				test.done();
			} );
		},
		
		function listGetInfo2(test) {
			var self = this;
			test.expect(19);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after new page push: " + err );
				test.ok( list.first_page == list.last_page - 1, "First page and last page are one apart" );
				
				// check internals
				self.storage.get( 'list2', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 11, "List length is 11: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 1, "List last_page is 1: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list2/0', function(err, page) {
						test.ok( !err, "No error fetching first list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 10, "List page has 10 items: " + page.items.length );
						
						self.storage.get( 'list2/1', function(err, page) {
							test.ok( !err, "No error fetching second list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
							test.done();
						} );
					} );
				} ); // internals
			} );
		},
		
		function listEach(test) {
			// iterate over list items using listEach
			var num_items = 0;
			this.storage.listEach( 'list2',
				function(item, idx, callback) {
					test.ok( !!item, "Got item" );
					test.ok( item.number == idx, "Item has correct number property" );
					num_items++;
					callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					test.ok( num_items == 11, "Iterated 11 items: " + num_items );
					test.done();
				}
			);
		},
		
		function listEachPage(test) {
			// iterate over list pages
			var num_pages = 0;
			this.storage.listEachPage( 'list2',
				function(items, callback) {
					test.ok( !!items, "Got items from page" );
					test.ok( !!items.length, "Nonzero items from page" );
					num_pages++;
					callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					test.ok( num_pages == 2, "Iterated 2 pages: " + num_pages );
					test.done();
				}
			);
		},
		
		function listEachUpdate(test) {
			// update some items
			var self = this;
			
			this.storage.listEachUpdate( 'list2',
				function(item, idx, callback) {
					if (idx % 2 == 1) {
						item.odd = true;
						callback(null, true);
					}
					else callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					
					self.storage.listGet( 'list2', 0, 0, function(err, items) {
						test.ok( !err, "No error fetching list2: " + err );
						test.ok( !!items, "Items is true" );
						test.ok( items.length == 11, "List has 11 items: " + items.length );
						
						for (var idx = 0, len = items.length; idx < len; idx++) {
							var item = items[idx];
							if (idx % 2 == 1) test.ok( !!item.odd, "Odd item is now odd" );
							else test.ok( !item.odd, "Even item is not odd" );
						}
						
						test.done();
					} );
				}
			);
		},
		
		function listEachPageUpdate(test) {
			// update some items, a page at a time
			var self = this;
			
			this.storage.listEachPageUpdate( 'list2',
				function(items, callback) {
					items.forEach( function(item) {
						if (!item.odd) item.even = true;
					} );
					callback(null, true);
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					
					self.storage.listGet( 'list2', 0, 0, function(err, items) {
						test.ok( !err, "No error fetching list2: " + err );
						test.ok( !!items, "Items is true" );
						test.ok( items.length == 11, "List has 11 items: " + items.length );
						
						for (var idx = 0, len = items.length; idx < len; idx++) {
							var item = items[idx];
							if (idx % 2 == 0) test.ok( !!item.even, "Even item is now even" );
							else test.ok( !item.even, "Odd item is not even" );
						}
						
						test.done();
					} );
				}
			);
		},
		
		function listPop2(test) {
			test.expect(3);
			this.storage.listPop( 'list2', function(err, item) {
				test.ok( !err, "No error popping list: " + err );
				test.ok( !!item, "Item is true" );
				test.ok( item.number == 10, "List popped item value matches 10: " + item.number );
				test.done();
			} );
		},
		
		function listGetInfo3(test) {
			var self = this;
			test.expect(15);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after new page push: " + err );
				test.ok( list.first_page == list.last_page, "First page and last page are the same after pop" );
				
				// check internals
				self.storage.get( 'list2', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 10, "List length is 10: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list2/0', function(err, page) {
						test.ok( !err, "No error fetching first list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 10, "List page has 10 items: " + page.items.length );
						
						self.storage.get( 'list2/1', function(err, page) {
							test.ok( !!err, "Expected error fetching second list page: " + err );
							test.done();
						} );
					} );
				} ); // internals
			} );
		},
		
		function listPushNewPage2(test) {
			// This push should create a new page (again)
			test.expect(1);
			this.storage.listPush( 'list2', { foo: 'bar', number: 10, again: 1 }, function(err, data) {
				test.ok( !err, "No error pushing new page again: " + err );
				test.done();
			} );
		},
		
		function listGetInfo4(test) {
			var self = this;
			test.expect(19);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after new page push again: " + err );
				test.ok( list.first_page == list.last_page - 1, "First page and last page are one apart again" );
				
				// check internals
				self.storage.get( 'list2', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 11, "List length is 11: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 1, "List last_page is 1: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list2/0', function(err, page) {
						test.ok( !err, "No error fetching first list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 10, "List page has 10 items: " + page.items.length );
						
						self.storage.get( 'list2/1', function(err, page) {
							test.ok( !err, "No error fetching second list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
							test.done();
						} );
					} );
				} ); // internals
			} );
		},
		
		function listShift1(test) {
			var self = this;
			test.expect(4);
			this.storage.listShift( 'list2', function(err, item) {
				test.ok( !err, "No error shifting list: " + err );
				test.ok( !!item, "Item is true" );
				test.ok( item.number === 0, "List popped item value matches 0" );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function listGet2(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 10, "List has 10 items: " + items.length );
				test.ok( items[0].number == 1, "First item value matches 1" );
				test.ok( items[9].number == 10, "Last item value matches 10" );
				test.done();
			} );
		},
		
		function listGetInfo5(test) {
			var self = this;
			test.expect(19);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after new page push again: " + err );
				test.ok( list.first_page == list.last_page - 1, "First page and last page are one apart again still" );
				
				// page 0 should have 9 items, and page 1 should have 1 item.
				
				// check internals
				self.storage.get( 'list2', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 10, "List length is 10: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 1, "List last_page is 1: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list2/0', function(err, page) {
						test.ok( !err, "No error fetching first list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 9, "List page has 9 items: " + page.items.length );
						
						self.storage.get( 'list2/1', function(err, page) {
							test.ok( !err, "No error fetching second list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
							test.done();
						} );
					} );
				} ); // internals
			} );
		},
		
		function listGetCrossPage2(test) {
			// Trying multi-page fetch with partial data on first page
			test.expect(5);
			this.storage.listGet( 'list2', 8, 2, function(err, items) {
				test.ok( !err, "No error fetching list2(8,2): " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 2, "List has 2 items: " + items.length );
				test.ok( items[0].number == 9, "List item 0 value matches 9" );
				test.ok( items[1].number == 10, "List item 1 value matches 10" );
				test.done();
			} );
		},
		
		function listPushMulti2(test) {
			// Now filling up second page, should overflow onto third page
			var self = this;
			var idx = 0;
			test.expect(1);
			
			async.whilst(
				function() { return idx < 10; },
				function(callback) {
					self.storage.listPush( 'list2', { foo: 'bar3', number: 11 + idx++ }, function(err, data) {
						callback(err);
					} );
				},
				function(err) {
					test.ok( !err, "No error pushing items again: " + err );
					test.done();
				}
			);
		},
		
		function listGet3(test) {
			var self = this;
			test.expect(27);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 20, "List has 20 items: " + items.length );
				test.ok( items[0].number == 1, "First item value matches 1" );
				test.ok( items[19].number == 20, "Last item value matches 20" );
				
				// page 0 should have 9 items, page 1 should have 10 items, and page 2 should have 1 item, totaling 20.
				
				// check internals
				self.storage.get( 'list2', function(err, list) {
					test.ok( !err, "No error fetching list header: " + err );
					test.ok( !!list, "Got list data from header key" );
					test.ok( list.type == 'list', "List type is list: " + list.type );
					test.ok( list.length == 20, "List length is 20: " + list.length );
					test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
					test.ok( list.last_page == 2, "List last_page is 2: " + list.last_page );
					test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
					
					self.storage.get( 'list2/0', function(err, page) {
						test.ok( !err, "No error fetching first list page: " + err );
						test.ok( !!page, "Got list page data" );
						test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
						test.ok( !!page.items, "List page has items array" );
						test.ok( page.items.length == 9, "List page has 9 items: " + page.items.length );
						
						self.storage.get( 'list2/1', function(err, page) {
							test.ok( !err, "No error fetching second list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 10, "List page has 10 items: " + page.items.length );
							
							self.storage.get( 'list2/2', function(err, page) {
								test.ok( !err, "No error fetching third list page: " + err );
								test.ok( !!page, "Got list page data" );
								test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
								test.ok( !!page.items, "List page has items array" );
								test.ok( page.items.length == 1, "List page has 1 item: " + page.items.length );
								test.done();
							} );
						} );
					} );
				} ); // internals
			} );
		},
		
		function listCut1(test) {
			var self = this;
			test.expect(4);
			this.storage.listSplice( 'list2', 15, 2, null, function(err, items) {
				test.ok( !err, "No error cutting list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items[0].foo == 'bar3', "List cut item value matches" );
				test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
				test.done();
			} );
		},
		
		function listGet4(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
//console.log("GOT ITEMS", items);
				test.ok( items.length == 18, "List has 18 items: " + items.length );
				test.ok( items[0].number == 1, "First item value matches 1" );
				test.ok( items[17].number == 20, "Last item value matches 20" );
				test.done();
			} );
		},
		
		// Unshifting two items at beginning, should overflow first page and create new page at other end
		
		function listUnshiftNewPage1(test) {
			// These unshifts should create a new first page
			var self = this;
			test.expect(3);
			
			this.storage.listUnshift( 'list2', { foo: 'bar4', number: 0 }, function(err, data) {
				test.ok( !err, "No error unshifting list: " + err );
				
				self.storage.listUnshift( 'list2', { foo: 'bar4', number: -1 }, function(err, data) {
					test.ok( !err, "No error unshifting new page: " + err );
					test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
					test.done();
				} );
			} );
		},
		
		function listGet5(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.debug( "List Items:", items );
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 20, "List has 20 items: " + items.length );
				test.ok( items[0].number == -1, "First item value matches -1" );
				test.ok( items[19].number == 20, "Last item value matches 20" );
				test.done();
			} );
		},
		
		// Cutting off last 2 items that were unshifted, this causes root page to move back to 0
		
		function listCut2(test) {
			test.expect(3);
			this.storage.listSplice( 'list2', 0, 2, null, function(err, items) {
				test.debug( "Items Cut:", items );
				test.ok( !err, "No error cutting list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items[0].number == -1, "List cut item value matches -1" );
				test.done();
			} );
		},
		
		function listGet6(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 18, "List has 18 items: " + items.length );
				test.ok( items[0].number == 1, "First item value matches 1" );
				test.ok( items[17].number == 20, "Last item value matches 20" );
				test.done();
			} );
		},
		
		function listGet7(test) {
			// Testing fetching 5 items from 'end' of list (without knowing length)
			test.expect(5);
			this.storage.listGet( 'list2', -5, 0, function(err, items) {
				test.ok( !err, "No error fetching negative list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 5, "Got 5 items: " + items.length );
				test.ok( items[0].number == 14, "First item value matches 14" );
				test.ok( items[4].number == 20, "Last item value matches 20" );
				test.done();
			} );
		},
		
		// Adding 1000 items...
		
		function listPushMulti1000(test) {
			test.expect(1);
			
			var items = [];
			for (var idx = 0; idx < 1000; idx++) {
				items.push({ foo: 'bar5', number: 1000 + idx });
			}
			
			this.storage.listPush( 'list2', items, function(err, data) {
				test.ok( !err, "No error pushing 1000 items: " + err );
				test.done();
			} );
		},
		
		function listGet8(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1018, "List has 1018 items: " + items.length );
				test.ok( items[0].number == 1, "First item value matches 1" );
				test.ok( items[1017].number == 1999, "Last item value matches 1999" );
				test.done();
			} );
		},
		
		function listEach1(test) {
			// test listEach on large list with multiple pages
			test.expect(2);
			var num_items = 0;
			this.storage.listEach( 'list2',
				function(item, idx, callback) {
					if (item) num_items++;
					callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					test.ok( num_items == 1018, "Iterated 1018 items: " + num_items );
					test.done();
				}
			);
		},
		
		// Fetching 45 items from numerous pages in the middle
		
		function listGet9(test) {
			test.expect(5);
			this.storage.listGet( 'list2', 500, 45, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 45, "Got 45 items: " + items.length );
				test.ok( items[0].number == 1482, "First item value matches 1482" );
				test.ok( items[44].number == 1526, "Last item value matches 1526" );
				test.done();
			} );
		},
		
		// Cutting those 45 items out
		
		function listCut3(test) {
			test.expect(5);
			this.storage.listSplice( 'list2', 500, 45, null, function(err, items) {
				test.ok( !err, "No error cutting list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 45, "Got 45 items: " + items.length );
				test.ok( items[0].number == 1482, "First item value matches 1482" );
				test.ok( items[44].number == 1526, "Last item value matches 1526" );
				test.done();
			} );
		},
		
		function listGet10(test) {
			test.expect(4);
			this.storage.listGet( 'list2', 499, 1, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1, "Got 1 item: " + items.length );
				test.ok( items[0].number == 1481, "First item value matches 1481" );
				test.done();
			} );
		},
		
		function listGet11(test) {
			test.expect(4);
			this.storage.listGet( 'list2', 500, 1, function(err, items) {
				test.ok( !err, "No error fetching list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1, "Got 1 item: " + items.length );
				test.ok( items[0].number == 1527, "First item value matches 1527" );
				test.done();
			} );
		},
		
		function listGetInfo6(test) {
			test.expect(2);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after new page push again: " + err );
				test.ok( list.length == 973, "List has 973 items: " + list.length );
				test.done();
			} );
		},
		
		// Testing fetching 5 items from 'end' of list (without knowing length) -- again
		
		function listGet12(test) {
			// Testing fetching 5 items from 'end' of list (without knowing length)
			test.expect(5);
			this.storage.listGet( 'list2', -5, 0, function(err, items) {
				test.ok( !err, "No error fetching negative list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 5, "Got 5 items: " + items.length );
				test.ok( items[0].number == 1995, "First item value matches 1995" );
				test.ok( items[4].number == 1999, "Last item value matches 1999" );
				test.done();
			} );
		},
		
		// Most difficult of all -- cut 11 items, one item at a time, from the second page (first page can shrink / move, second page cannot)
		
		function listCutMultiInsane(test) {
			var self = this;
			var idx = 0;
			// test.expect(1);
			
			async.whilst(
				function() { return idx < 11; },
				function(callback) {
					self.storage.listSplice( 'list2', 18, 1, null, function(err, items) {
						test.ok( !err, "No error cutting list: " + err );
						test.ok( !!items, "Items is true" );
						test.ok( items.length == 1, "Got 1 items: " + items.length );
						test.ok( items[0].number == idx + 1000, "First item value matches 1482" );
						
						if (err) return callback(err);
						
						self.storage.listGet( 'list2', -1, 0, function(err, items) {
							test.ok( !err, "No error fetching negative list: " + err );
							test.ok( !!items, "Items is true" );
							test.ok( items.length == 1, "Got 1 items: " + items.length );
							test.ok( items[0].number == 1999, "Last item value matches 1999" );
							
							idx++;
							callback(err);
						} );
					} );
				},
				function(err) {
					test.ok( !err, "No error splicing insanity: " + err );
					test.ok( Object.keys(self.storage.locks).length == 0, "No more locks leftover in storage" );
					test.done();
				}
			);
		},
		
		function listGetInfo7(test) {
			test.expect(2);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !err, "No error getting list info after multi-cut: " + err );
				test.ok( list.length == 962, "List has 962 items: " + list.length );
				test.done();
			} );
		},
		
		function listGet13(test) {
			// Testing fetching 5 items from 'end' of list (without knowing length)
			test.expect(5);
			this.storage.listGet( 'list2', -5, 0, function(err, items) {
				test.ok( !err, "No error fetching negative list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 5, "Got 5 items: " + items.length );
				test.ok( items[0].number == 1995, "First item value matches 1995" );
				test.ok( items[4].number == 1999, "Last item value matches 1999" );
				test.done();
			} );
		},
		
		function listFind1(test) {
			test.expect(4);
			this.storage.listFind( 'list2', { foo: 'bar5', number: 1527 }, function(err, item, idx) {
				test.ok( !err, "No error searching list: " + err );
				test.ok( !!item, "Item is true" );
				test.ok( item.foo == 'bar5', "Item foo matches bar5" );
				test.ok( item.number == 1527, "Item value matches 1527" );
				test.done();
			} );
		},
		
		function listFindRegExp1(test) {
			var self = this;
			test.expect(7);
			
			this.storage.listFind( 'list2', { foo: /^BAR5$/i, number: /1527/ }, function(err, item, idx) {
				test.ok( !err, "No error searching list: " + err );
				test.ok( !!item, "Item is true" );
				test.ok( item.foo == 'bar5', "Item foo matches bar5" );
				test.ok( item.number == 1527, "Item value matches 1527" );
				
				// check negative case
				self.storage.listFind( 'list2', { foo: /^bar6$/ }, function(err, item, idx) {
					test.ok( !err, "No error expected searching list: " + err );
					test.ok( !item, "Item is expected to be null" );
					test.ok( idx == -1, "Item idx is expected to be -1: " + idx );
					test.done();
				} );
			} );
		},
		
		function listFindBad1(test) {
			test.expect(3);
			this.storage.listFind( 'list2', { number: 2000 }, function(err, item, idx) {
				test.ok( !err, "No error expected searching list: " + err );
				test.ok( !item, "Item is expected to be null" );
				test.ok( idx == -1, "Item idx is expected to be -1: " + idx );
				test.done();
			} );
		},
		
		function listCopy1(test) {
			var self = this;
			test.expect(5);
			
			this.storage.listCopy( 'list2', 'list3', function(err) {
				test.ok( !err, "No error expected copying list: " + err );
				
				self.storage.listGet( 'list3', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 962, "New list3 has 962 items: " + items.length );
					test.ok( items[961].number == 1999, "List item value matches" );
					test.done();
				} );
				
			} );
		},
		
		function listRename1(test) {
			var self = this;
			test.expect(8);
			
			this.storage.listRename( 'list3', 'list4', function(err) {
				test.ok( !err, "No error expected renaming list: " + err );
				
				self.storage.listGet( 'list3', 0, 0, function(err, items) {
					test.ok( !!err, "Expected error fetching the now deleted list3" );
					test.ok( !items, "Items is false" );
					
					self.storage.listGet( 'list4', 0, 0, function(err, items) {
						test.ok( !err, "No error fetching list: " + err );
						test.ok( !!items, "Items is true" );
						test.ok( items.length == 962, "New list4 has 962 items: " + items.length );
						test.ok( items[961].number == 1999, "List item value matches" );
						
						self.storage.listDelete( 'list4', true, function(err, data) {
							test.ok( !err, "No error deleting list4: " + err );
							test.done();
						} );
					} );
				} );
				
			} );
		},
		
		// Splice cut with a larger insert
		
		function listSpliceInsertLarger(test) {
			var self = this;
			test.expect(8);
			
			var to_insert = [
				{ inserted: 1 },
				{ inserted: 2 }
			];
			this.storage.listSplice( 'list2', 400, 1, to_insert, function(err, items) {
				test.ok( !err, "No error splicing list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1, "List cut 1 item" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 963, "list2 now has 963 items: " + items.length );
					test.ok( items[400].inserted == 1, "Inserted item value matches" );
					test.ok( items[962].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		// Splice cut with a smaller insert
		
		function listSpliceInsertSmaller(test) {
			var self = this;
			test.expect(8);
			
			var to_insert = [
				{ inserted: 3 }
			];
			this.storage.listSplice( 'list2', 410, 2, to_insert, function(err, items) {
				test.ok( !err, "No error splicing list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 2, "List cut 2 items" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 962, "list2 now has 962 items: " + items.length );
					test.ok( items[410].inserted == 3, "Inserted item value matches" );
					test.ok( items[961].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		// Splice with an equal cut + insert
		
		function listSpliceInsertEqual(test) {
			var self = this;
			test.expect(8);
			
			var to_insert = [
				{ inserted: 4 },
				{ inserted: 5 }
			];
			this.storage.listSplice( 'list2', 420, 2, to_insert, function(err, items) {
				test.ok( !err, "No error splicing list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 2, "List cut 2 items" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 962, "list2 now has 962 items: " + items.length );
					test.ok( items[420].inserted == 4, "Inserted item value matches" );
					test.ok( items[961].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		// 0-item cut splice with an insert
		
		function listSpliceZeroInsert(test) {
			var self = this;
			test.expect(8);
			
			var to_insert = [
				{ inserted: 6 },
				{ inserted: 7 }
			];
			this.storage.listSplice( 'list2', 430, 0, to_insert, function(err, items) {
				test.ok( !err, "No error splicing list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 0, "List cut 0 items" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 964, "list2 now has 964 items: " + items.length );
					test.ok( items[430].inserted == 6, "Inserted item value matches" );
					test.ok( items[963].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		// Splice insert with enough new items to cause a new page
		
		function listSpliceInsertLarger2(test) {
			var self = this;
			test.expect(8);
			
			var to_insert = [
				{ inserted: 10 },
				{ inserted: 11 },
				{ inserted: 12 },
				{ inserted: 13 },
				{ inserted: 14 },
				{ inserted: 15 },
				{ inserted: 16 },
				{ inserted: 17 },
				{ inserted: 18 },
				{ inserted: 19 },
				{ inserted: 20, vegetable: "carrot" },
				{ inserted: 21, vegetable: "carrot" },
				{ inserted: 22, vegetable: "carrot" }
			];
			this.storage.listSplice( 'list2', 440, 1, to_insert, function(err, items) {
				test.ok( !err, "No error splicing list: " + err );
				test.ok( !!items, "Items is true" );
				test.ok( items.length == 1, "List cut 1 item" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 976, "list2 now has 976 items: " + items.length );
					test.ok( items[440].inserted == 10, "Inserted item value matches" );
					test.ok( items[975].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		function listFindCut1(test) {
			// test the listFindCut macro function
			var self = this;
			test.expect(10);
			
			this.storage.listFindCut( 'list2', { inserted: 17 }, function(err, item) {
				test.ok( !err, "No error after listFindCut: " + err );
				test.ok( !!item, "Cut item is true" );
				test.ok( item.inserted == 17, "Cut item value matches" );
				test.ok( Object.keys(self.storage.locks).length == 0, "No locks remaining after listFindCut" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 975, "list2 now has 975 items: " + items.length );
					test.ok( items[440].inserted == 10, "Item value matches before splice area" );
					test.ok( items[447].inserted == 18, "Item value matches after splice area" );
					test.ok( items[974].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		function listFindReplace1(test) {
			// test the listFindReplace macro function
			var self = this;
			test.expect(7);
			
			this.storage.listFindReplace( 'list2', { inserted: 18 }, { replaced: 18, counter: 1 }, function(err) {
				test.ok( !err, "No error after listFindReplace: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No locks remaining after listFindReplace" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 975, "list2 still has 975 items: " + items.length );
					test.ok( items[447].replaced == 18, "Item value matches after replace" );
					test.ok( items[974].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		function listFindUpdate1(test) {
			// test the listFindUpdate macro function
			var self = this;
			var criteria = { replaced: 18 };
			var updates = { replaced: 118, counter: "+1", newfoo: "hello" };
			test.expect(9);
			
			this.storage.listFindUpdate( 'list2', criteria, updates, function(err, item) {
				test.ok( !err, "No error after listFindUpdate: " + err );
				test.ok( Object.keys(self.storage.locks).length == 0, "No locks remaining after listFindUpdate" );
				
				self.storage.listGet( 'list2', 0, 0, function(err, items) {
					test.ok( !err, "No error fetching list: " + err );
					test.ok( !!items, "Items is true" );
					test.ok( items.length == 975, "list2 still has 975 items: " + items.length );
					test.ok( items[447].replaced == 118, "Item value matches after update" );
					test.ok( items[447].counter == 2, "Counter was successfully incremented" );
					test.ok( items[447].newfoo == "hello", "New property was successfully added" );
					test.ok( items[974].number == 1999, "Last item value matches" );
					test.done();
				} );
			} );
		},
		
		function listFindEach1(test) {
			// test listFindEach on large list with multiple pages
			test.expect(8);
			var num_items = 0;
			var criteria = { vegetable: "carrot" };
			
			this.storage.listFindEach( 'list2', criteria, 
				function(item, idx, callback) {
					if (item) num_items++;
					test.ok( !!item, "Item was passed to iterator" );
					test.ok( item.vegetable == 'carrot', "Item has correct vegetable" );
					callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					test.ok( num_items == 3, "Found 3 items: " + num_items );
					test.done();
				}
			);
		},
		
		function listFindEachRegExp1(test) {
			// test listFindEach on large list with multiple pages, using reg exp
			test.expect(8);
			var num_items = 0;
			var criteria = { vegetable: /^CARROT$/i };
			
			this.storage.listFindEach( 'list2', criteria, 
				function(item, idx, callback) {
					if (item) num_items++;
					test.ok( !!item, "Item was passed to iterator" );
					test.ok( item.vegetable == 'carrot', "Item has correct vegetable" );
					callback();
				},
				function(err) {
					test.ok( !err, "No error iterating list: " + err );
					test.ok( num_items == 3, "Found 3 items: " + num_items );
					test.done();
				}
			);
		},
		
		// Deleting entire list
		
		function listDelete2(test) {
			test.expect(1);
			this.storage.listDelete( 'list2', true, function(err, data) {
				test.ok( !err, "No error deleting list2: " + err );
				test.done();
			} );
		},
		
		// Making sure list2 was deleted
		
		function listGetEmpty4(test) {
			test.expect(1);
			this.storage.listGet( 'list2', 0, 0, function(err, items) {
				test.ok( !!err, "Error expected getting deleted list2" );
				test.done();
			} );
		},
		
		function listGetInfoEmpty2(test) {
			test.expect(1);
			this.storage.listGetInfo( 'list2', function(err, list) {
				test.ok( !!err, "Error expected getting list2 info after delete" );
				test.done();
			} );
		},
		
		function listShiftClear(test) {
			// create list with 1 item, then shift it off, and make sure we have a clean empty list leftover
			var self = this;
			var key = 'clearlist1';
			test.expect( 17 );
			
			this.storage.listPush( key, { foo: 'bar' }, function(err) {
				test.ok( !err, "No error pushing list: " + err );
				
				self.storage.listShift( key, function(err, item) {
					test.ok( !err, "No error shifting list: " + err );
					
					self.storage.get( key, function(err, list) {
						test.ok( !err, "No error fetching list header: " + err );
						test.ok( !!list, "Got list data from header key" );
						test.ok( list.type == 'list', "List type is list: " + list.type );
						test.ok( list.length == 0, "List length is 0: " + list.length );
						test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
						test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
						test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
						
						self.storage.get( key + '/0', function(err, page) {
							test.ok( !err, "No error fetching list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 0, "List page has 0 items: " + page.items.length );
							
							self.storage.listDelete( key, true, function(err) {
								test.ok( !err, "No error deleting list: " + err );
								
								self.storage.get( key, function(err, list) {
									test.ok( !!err, "Error expected fetching list header after delete: " + err );
									
									self.storage.get( key + '/0', function(err, page) {
										test.ok( !!err, "Error expected fetching list page after delete: " + err );
										test.done();
									} ); // get page
								} ); // get header
							} ); // delete
						} ); // get page
					} ); // get header
				} ); // shift
			} ); // push
		},
		
		function listPopClear(test) {
			// create list with 1 item, then pop it off, and make sure we have a clean empty list leftover
			var self = this;
			var key = 'clearlist2';
			test.expect( 17 );
			
			this.storage.listPush( key, { foo: 'bar' }, function(err) {
				test.ok( !err, "No error pushing list: " + err );
				
				self.storage.listPop( key, function(err, item) {
					test.ok( !err, "No error popping list: " + err );
					
					self.storage.get( key, function(err, list) {
						test.ok( !err, "No error fetching list header: " + err );
						test.ok( !!list, "Got list data from header key" );
						test.ok( list.type == 'list', "List type is list: " + list.type );
						test.ok( list.length == 0, "List length is 0: " + list.length );
						test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
						test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
						test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
						
						self.storage.get( key + '/0', function(err, page) {
							test.ok( !err, "No error fetching list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 0, "List page has 0 items: " + page.items.length );
							
							self.storage.listDelete( key, true, function(err) {
								test.ok( !err, "No error deleting list: " + err );
								
								self.storage.get( key, function(err, list) {
									test.ok( !!err, "Error expected fetching list header after delete: " + err );
									
									self.storage.get( key + '/0', function(err, page) {
										test.ok( !!err, "Error expected fetching list page after delete: " + err );
										test.done();
									} ); // get page
								} ); // get header
							} ); // delete
						} ); // get page
					} ); // get header
				} ); // pop
			} ); // push
		},
		
		function listSpliceClear(test) {
			// create list with 1 item, then splice it off, and make sure we have a clean empty list leftover
			var self = this;
			var key = 'clearlist3';
			test.expect( 17 );
			
			this.storage.listPush( key, { foo: 'bar' }, function(err) {
				test.ok( !err, "No error pushing list: " + err );
				
				self.storage.listSplice( key, 0, 1, [], function(err, item) {
					test.ok( !err, "No error splicing list: " + err );
					
					self.storage.get( key, function(err, list) {
						test.ok( !err, "No error fetching list header: " + err );
						test.ok( !!list, "Got list data from header key" );
						test.ok( list.type == 'list', "List type is list: " + list.type );
						test.ok( list.length == 0, "List length is 0: " + list.length );
						test.ok( list.first_page == 0, "List first_page is 0: " + list.first_page );
						test.ok( list.last_page == 0, "List last_page is 0: " + list.last_page );
						test.ok( list.page_size > 0, "List page_size is non-zero: " + list.page_size );
						
						self.storage.get( key + '/0', function(err, page) {
							test.ok( !err, "No error fetching list page: " + err );
							test.ok( !!page, "Got list page data" );
							test.ok( page.type == 'list_page', "Page type is correct: " + page.type );
							test.ok( !!page.items, "List page has items array" );
							test.ok( page.items.length == 0, "List page has 0 items: " + page.items.length );
							
							self.storage.listDelete( key, true, function(err) {
								test.ok( !err, "No error deleting list: " + err );
								
								self.storage.get( key, function(err, list) {
									test.ok( !!err, "Error expected fetching list header after delete: " + err );
									
									self.storage.get( key + '/0', function(err, page) {
										test.ok( !!err, "Error expected fetching list page after delete: " + err );
										test.done();
									} ); // get page
								} ); // get header
							} ); // delete
						} ); // get page
					} ); // get header
				} ); // splice
			} ); // push
		},
		
		function testListInsertSorted(test) {
			// test listInsertSorted with a bunch of unsorted items
			var self = this;
			test.expect( 207 );
			
			var original_usernames = ["fowlscottish", "cerebellumcameraman", "lewdastatine", "letterslist", "wildsquishy", "mailerresigned", "fobbingboyscouts", "cashewvenomed", "tetherballinterval", "hornjacket", "arcvallis", "soccersquish", "voltgummy", "garnthief", "interfaceagreeable", "publishercoma", "keygristle", "risingobliquity", "chorleyhoop", "inventorybugbear", "achingrigil", "wingedcohert", "unfastenplates", "chewingharrier", "tearfultor", "superiorlevers", "cracklescaly", "intnamibian", "nappingconcerns", "belchsurfing", "facialcantata", "pintailgroovy", "vanadiumcoxcomb", "floatintroduced", "muggergrilled", "fancyfacts", "darcynorth", "copernicuswinding", "gathertelephone", "stuffingxpath", "dopplericing", "thighapricots", "blazezany", "producecasimir", "diphthongpage", "staineddrones", "aboveyorkie", "isolatestick", "chillyamazon", "leadhonky", "clothingcompany", "crumpetssartorial", "austrinaworms", "terminallyimproper", "smewfarrum", "sundaycoloured", "evalblot", "tripglobe", "russelpatrick", "methodtiming", "expertnoodles", "rubbishroomy", "sonorefactor", "lagrangeskipping", "alcoholicwho", "biotapet", "cooksweak", "onioneconomic", "tillitewhispered", "morfilk", "tubprompting", "offensethirsty", "pavoconcave", "varicoseroseate", "hooklaunching", "lambbossy", "dauphineabove", "auctionwhip", "joystough", "triggersantenna", "papesslicer", "cancersmoronic", "porridgeio", "abashedscrubbing", "bushfinished", "dewmumps", "mugrail", "whatloin", "clerkmilitary", "hindermoral", "relateactivity", "boundedstutter", "strikingtrusty", "itchingtheory", "genderscodelevels", "pilcrowpresenting", "actuallyarray", "harpyeven", "brownplain", "herbroot", "cinderdote", "stashrattle", "departmentovert", "sandwicharmy", "mensaleft", "levelpickled", "precipitatepicked", "neutrinosmashed", "fagwholesale", "faculaefett", "pradamind", "geezersabine", "keepbowel", "combineschist", "housestinging", "kettleneigh", "resonantwakeful", "tawnydeal", "cutsordid", "agitatedmammary", "tractorposition", "sootsubmerge", "negativelytugofwar", "obsequioustemperature", "mexicancompiler", "stipulatebaste", "occulationcola", "fashionsoblateness", "equipmentbelieve", "pesterstaccato", "prettyingcramer", "russianparanoid", "joyousslamming", "tinglingfix", "painsplace", "thalliumbabyish", "residenceduality", "stringsbaa", "resultbiggest", "patisseriesuggestion", "planetshedgehog", "crossfairly", "subtleextinct", "cosinespies", "codsole", "grippingclosed", "appealsmaple", "feathercliche", "distractedstall", "grottysince", "initsardonic", "washgarden", "ablazelowly", "bastingplutonic", "nepalesebloviate", "dogsiberian", "stammerbreasts", "includedmettled", "scenesterpitter", "cherriestotal", "lethalhappen", "facebookprograde", "crownbetter", "cheekyfluctus", "jetproton", "droppingsuntimely", "egretimpish", "sparcpluck", "grantgross", "whickerkebab", "boanagging", "neighborlykaput", "powerfulbubble", "respondcreep", "celestgoes", "observeacidic", "aldermancrow", "leafyshortstop", "bombsecurity", "hushedus", "cratehornbill", "daughterenjoy", "heapxna", "gradesynth", "clamtrust", "doublingdover", "renamebreak", "unwrittentattler", "olympicslow", "stumblingvenues", "ossifiedproof", "ruffwilderness", "vanquishimportance", "dnabefore", "designedtit", "woodenblackwell", "chainbroil", "boulangereascension", "joneslegato", "factwizards"];
			
			var sorted_usernames = ["abashedscrubbing", "ablazelowly", "aboveyorkie", "achingrigil", "actuallyarray", "agitatedmammary", "alcoholicwho", "aldermancrow", "appealsmaple", "arcvallis", "auctionwhip", "austrinaworms", "bastingplutonic", "belchsurfing", "biotapet", "blazezany", "boanagging", "bombsecurity", "boulangereascension", "boundedstutter", "brownplain", "bushfinished", "cancersmoronic", "cashewvenomed", "celestgoes", "cerebellumcameraman", "chainbroil", "cheekyfluctus", "cherriestotal", "chewingharrier", "chillyamazon", "chorleyhoop", "cinderdote", "clamtrust", "clerkmilitary", "clothingcompany", "codsole", "combineschist", "cooksweak", "copernicuswinding", "cosinespies", "cracklescaly", "cratehornbill", "crossfairly", "crownbetter", "crumpetssartorial", "cutsordid", "darcynorth", "daughterenjoy", "dauphineabove", "departmentovert", "designedtit", "dewmumps", "diphthongpage", "distractedstall", "dnabefore", "dogsiberian", "dopplericing", "doublingdover", "droppingsuntimely", "egretimpish", "equipmentbelieve", "evalblot", "expertnoodles", "facebookprograde", "facialcantata", "factwizards", "faculaefett", "fagwholesale", "fancyfacts", "fashionsoblateness", "feathercliche", "floatintroduced", "fobbingboyscouts", "fowlscottish", "garnthief", "gathertelephone", "geezersabine", "genderscodelevels", "gradesynth", "grantgross", "grippingclosed", "grottysince", "harpyeven", "heapxna", "herbroot", "hindermoral", "hooklaunching", "hornjacket", "housestinging", "hushedus", "includedmettled", "initsardonic", "interfaceagreeable", "intnamibian", "inventorybugbear", "isolatestick", "itchingtheory", "jetproton", "joneslegato", "joyousslamming", "joystough", "keepbowel", "kettleneigh", "keygristle", "lagrangeskipping", "lambbossy", "leadhonky", "leafyshortstop", "lethalhappen", "letterslist", "levelpickled", "lewdastatine", "mailerresigned", "mensaleft", "methodtiming", "mexicancompiler", "morfilk", "muggergrilled", "mugrail", "nappingconcerns", "negativelytugofwar", "neighborlykaput", "nepalesebloviate", "neutrinosmashed", "obsequioustemperature", "observeacidic", "occulationcola", "offensethirsty", "olympicslow", "onioneconomic", "ossifiedproof", "painsplace", "papesslicer", "patisseriesuggestion", "pavoconcave", "pesterstaccato", "pilcrowpresenting", "pintailgroovy", "planetshedgehog", "porridgeio", "powerfulbubble", "pradamind", "precipitatepicked", "prettyingcramer", "producecasimir", "publishercoma", "relateactivity", "renamebreak", "residenceduality", "resonantwakeful", "respondcreep", "resultbiggest", "risingobliquity", "rubbishroomy", "ruffwilderness", "russelpatrick", "russianparanoid", "sandwicharmy", "scenesterpitter", "smewfarrum", "soccersquish", "sonorefactor", "sootsubmerge", "sparcpluck", "staineddrones", "stammerbreasts", "stashrattle", "stipulatebaste", "strikingtrusty", "stringsbaa", "stuffingxpath", "stumblingvenues", "subtleextinct", "sundaycoloured", "superiorlevers", "tawnydeal", "tearfultor", "terminallyimproper", "tetherballinterval", "thalliumbabyish", "thighapricots", "tillitewhispered", "tinglingfix", "tractorposition", "triggersantenna", "tripglobe", "tubprompting", "unfastenplates", "unwrittentattler", "vanadiumcoxcomb", "vanquishimportance", "varicoseroseate", "voltgummy", "washgarden", "whatloin", "whickerkebab", "wildsquishy", "wingedcohert", "woodenblackwell"];
			
			async.eachSeries( original_usernames, 
				function(username, callback) {
					self.storage.listInsertSorted( 'sortedlist1', { username: username, foo: "barsorted1" }, ['username', 1], callback );
				}, 
				function(err) {
					test.ok( !err, "No error inserting items: " + err );
					
					// now fetch entire list to see if sorting worked
					self.storage.listGet( 'sortedlist1', 0, 0, function(err, items) {
						test.ok( !err, "No error fetching list: " + err );
						test.ok( !!items, "Items is true" );
						test.ok( items.length == 200, "sortedlist1 has 200 items: " + items.length );
						test.ok( items[0].foo == "barsorted1", "First item has expected content" );
						test.ok( items[199].foo == "barsorted1", "Last item has expected content" );
						
						for (var idx = 0, len = items.length; idx < len; idx++) {
							test.ok(
								items[idx].username == sorted_usernames[idx], 
								"Item " + idx + " matches sorted username: " + items[idx].username + " == " + sorted_usernames[idx]
							);
						}
						
						self.storage.listDelete( 'sortedlist1', true, function(err, data) {
							test.ok( !err, "No error deleting sortedlist1: " + err );
							test.done();
						} );
					} ); // loaded list
				} // eachSeries complete 
			); // eachSeries
		}
		
	], // tests array
	
	makeIntArray: function(from, to, max) {
		// create array containing range of integers
		var arr = [];
		for (var idx = from; idx <= to; idx++) arr.push(idx);
		
		if (max && (arr.length > max)) {
			arr = [];
			for (var amount = 0; amount < max; amount++) {
				arr.push( Math.floor( from + ((to - from) * (amount / (max - 1))) ) );
			}
		}
		
		return arr;
	},
	
	generateSpliceTest: function(setup_func, initial_len, cut_idx, cut_len, ins_len) {
		// generate single splice test given specific args
		var test_func = function(test) {
			// run test
			var self = this;
			var key = 'listomatic';
			
			var initial_items = [];
			for (var idx = 0; idx < initial_len; idx++) {
				initial_items.push({ name: "initial " + idx });
			}
			
			var new_items = [];
			for (var idx = 0; idx < ins_len; idx++) {
				new_items.push({ name: "INSERTED " + idx });
			}
			
			// create and splice reference array
			var ref_arr = JSON.parse( JSON.stringify(initial_items) );
			var ref_splice_args = [ cut_idx, cut_len ].concat( JSON.parse( JSON.stringify(new_items) ) );
			[].splice.apply( ref_arr, ref_splice_args );
			
			async.series(
				[
					function(callback) {
						// create list
						if (initial_len) {
							// listPush or listUnshift
							self.storage[setup_func]( key, initial_items, callback );
						}
						else {
							// no initial items, so use listCreate
							self.storage.listCreate( key, {}, callback );
						}
					},
					function(callback) {
						// splice
						self.storage.listSplice( key, cut_idx, cut_len, new_items, callback );
					},
					function(callback) {
						// load entire list to compare
						self.storage.listGet( key, 0, 0, function(err, items, list) {
							test.ok( !err, "No error fetching list: " + err );
							test.ok( !!items, "Items is true" );
							test.ok( !!list, "List is true" );
							
							test.debug( "Ref Array: ", ref_arr );
							test.debug( "Final Items: ", items );
							test.debug( "List Header: ", list );
							
							test.ok( list.length == items.length, "List has correct number of items: " + list.length );
							test.ok( items.length == ref_arr.length, "Item length matches reference array: " + items.length );
							
							for (var idx = 0, len = items.length; idx < len; idx++) {
								test.ok( !!items[idx], "Item " + idx + " exists" );
								test.ok( !!items[idx].name, "Item " + idx + " has a name property" );
								test.ok(
									items[idx].name == ref_arr[idx].name, 
									"Item " + idx + " value matches ref array: " + items[idx].name + " == " + ref_arr[idx].name
								);
							}
							
							callback();
						}); // listGet
					}
				],
				function(err) {
					test.ok( !err, "No error during splice operations: " + err );
					
					// always delete list
					self.storage.listDelete( key, true, function(err) {
						test.ok( !err, "No error deleting list: " + err );
						test.done();
					} );
				}
			); // async.series
		}; // test func
		
		test_func.testName = 'listSpliceMatrix_' + 
			((setup_func == 'listPush') ? 'Psh' : 'Unsh') + 
			'_Init' + initial_len + '_Idx' + cut_idx + '_Cut' + cut_len + '_Ins' + ins_len;
			
		return test_func;
	},
	
	generateSpliceTests: function() {
		// generate special splice tests with known args
		var self = this;
		var tests = [];
		
		// try creating list with push and unshift
		['listPush', 'listUnshift'].forEach( function(setup_func) {
		// ['listPush'].forEach( function(setup_func) {
			
			// try all different initial list sizes
			[0, 1, 4, 5, 6, 9, 10, 11, 15, 19, 20, 21, 25, 29, 30, 31].forEach( function(initial_len) {
			// [0, 1, 4, 5, 9, 10, 11, 19, 20, 30, 31].forEach( function(initial_len) {
				
				// try all cut positions
				self.makeIntArray(0, initial_len, 5).forEach( function(cut_idx) {
					
					// try all cut lengths
					var max_cut_len = initial_len - cut_idx;
					self.makeIntArray(0, max_cut_len, 5).forEach( function(cut_len) {
						
						// try various insert lengths
						[0, 1, 2, 9, 10, 11, 19, 20, 30, 32, 40].forEach( function(ins_len) {
						// [0, 1, 2, 9, 10, 11, 19, 32, 40].forEach( function(ins_len) {
						// [0].forEach( function(ins_len) {
							
							// generate test function
							tests.push( 
								self.generateSpliceTest( setup_func, initial_len, cut_idx, cut_len, ins_len ) 
							);
						} ); // ins_len loop
					} ); // cut_len loop
				} ); // cut_idx loop
			} ); // initial_len loop
		} ); // setup_func loop
		
		return tests;
	}
};
