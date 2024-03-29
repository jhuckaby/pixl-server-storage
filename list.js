// PixlServer Storage System - List Mixin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

var ListSplice = require("./list-splice.js");

// support for older node versions
var isArray = Array.isArray || util.isArray;

module.exports = Class.create({
	
	__mixins: [ ListSplice ],
	
	listCreate: function(key, opts, callback) {
		// Create new list
		var self = this;
		
		if (!opts) opts = {};
		if (!opts.page_size) opts.page_size = this.listItemsPerPage;
		opts.first_page = 0;
		opts.last_page = 0;
		opts.length = 0;
		opts.type = 'list';
		
		this.logDebug(9, "Creating new list: " + key, opts);
		
		this.get(key, function(err, list) {
			if (list) {
				// list already exists
				return callback(null, list);
			}
			self.put( key, opts, function(err) {
				if (err) return callback(err);
				
				// create first page
				self.put( key + '/0', { type: 'list_page', items: [] }, function(err) {
					if (err) return callback(err);
					else callback(null, opts);
				} );
			} ); // header created
		} ); // get check
	},
	
	_listLoad: function(key, create_opts, callback) {
		// Internal method, load list root, create if doesn't exist
		var self = this;
		if (create_opts && (typeof(create_opts) != 'object')) create_opts = {};
		this.logDebug(9, "Loading list: " + key);
		
		this.get(key, function(err, data) {
			if (data) {
				// list already exists
				callback(null, data);
			}
			else if (create_opts && err && (err.code == "NoSuchKey")) {
				// create new list, ONLY if record was not found (and not some other error)
				self.logDebug(9, "List not found, creating it: " + key, create_opts);
				self.listCreate(key, create_opts, function(err, data) {
					if (err) callback(err, null);
					else callback( null, data );
				} );
			}
			else {
				// no exist and no create, or some other error
				self.logDebug(9, "List could not be loaded: " + key + ": " + err);
				callback(err, null);
			}
		} ); // get
	},
	
	_listLoadPage: function(key, idx, create, callback) {
		// Internal method, load page from list, create if doesn't exist
		var self = this;
		var page_key = key + '/' + idx;
		this.logDebug(9, "Loading list page: " + page_key);
		
		this.get(page_key, function(err, data) {
			if (data) {
				// list page already exists
				callback(null, data);
			}
			else if (create && err && (err.code == "NoSuchKey")) {
				// create new list page, ONLY if record was not found (and not some other error)
				self.logDebug(9, "List page not found, creating it: " + page_key);
				callback( null, { type: 'list_page', items: [] } );
			}
			else {
				// no exist and no create
				self.logDebug(9, "List page could not be loaded: " + page_key + ": " + err);
				callback(err, null);
			}
		} ); // get
	},
	
	_listLock: function(key, wait, callback) {
		// internal list lock wrapper
		// uses unique key prefix so won't deadlock with user locks
		this.lock( '|'+key, wait, callback );
	},
	
	_listUnlock: function(key) {
		// internal list unlock wrapper
		this.unlock( '|'+key );
	},
	
	_listShareLock: function(key, wait, callback) {
		// internal list shared lock wrapper
		// uses unique key prefix so won't deadlock with user locks
		this.shareLock( 'C|'+key, wait, callback );
	},
	
	_listShareUnlock: function(key) {
		// internal list shared unlock wrapper
		this.shareUnlock( 'C|'+key );
	},
	
	listPush: function(key, items, create_opts, callback) {
		// Push new items onto end of list
		var self = this;
		if (!callback && (typeof(create_opts) == 'function')) {
			callback = create_opts;
			create_opts = {};
		}
		var list = null;
		var page = null;
		if (!isArray(items)) items = [items];
		this.logDebug(9, "Pushing " + items.length + " items onto end of list: " + key, this.debugLevel(10) ? items : null);
		
		this._listLock(key, true, function() {
			async.series([
				function(callback) {
					// first load list header
					self._listLoad(key, create_opts, function(err, data) {
						list = data; 
						callback(err, data);
					} );
				},
				function(callback) {
					// now load last page in list
					self._listLoadPage(key, list.last_page, 'create', function(err, data) {
						page = data;
						callback(err, data);
					} );
				}
			],
			function(err, results) {
				// list and page loaded, proceed with push
				if (err) {
					self._listUnlock(key);
					return callback(err, null);
				}
				
				// populate tasks array with records to save
				var tasks = [];
				
				// split items into pages
				var item = null;
				var count = 0;
				while (item = items.shift()) {
					// make sure item is an object
					if (typeof(item) != 'object') continue;
					
					// if last page is full, we need to create a new one
					if (page.items.length >= list.page_size) {
						// complete current page, queue for save
						if (count) tasks.push({ key: key + '/' + list.last_page, data: page });
						
						// add new page
						list.last_page++;
						page = { type: 'list_page', items: [] };
					}
					
					// push item onto list
					page.items.push( item );
					list.length++;
					count++;
				} // foreach item
				
				if (!count) {
					self._listUnlock(key);
					return callback(new Error("No valid objects found to add."), null);
				}
				
				// add current page, and main list record
				tasks.push({ key: key + '/' + list.last_page, data: page });
				tasks.push({ key: key, data: list });
				
				// save all pages and main list
				var lastErr = null;
				var q = async.queue(function (task, callback) {
					self.put( task.key, task.data, callback );
				}, self.concurrency );
				
				q.drain = function() {
					// all pages saved, complete
					self._listUnlock(key);
					callback(lastErr, list);
				};
				
				q.push( tasks, function(err) {
					lastErr = err;
				} );
				
			} ); // loaded
		} ); // locked
	},
	
	listUnshift: function(key, items, create_opts, callback) {
		// Unshift new items onto beginning of list
		var self = this;
		if (!callback && (typeof(create_opts) == 'function')) {
			callback = create_opts;
			create_opts = {};
		}
		var list = null;
		var page = null;
		if (!isArray(items)) items = [items];
		this.logDebug(9, "Unshifting " + items.length + " items onto beginning of list: " + key, this.debugLevel(10) ? items : null);
		
		this._listLock( key, true, function() {
			async.series([
				function(callback) {
					// first load list header
					self._listLoad(key, create_opts, function(err, data) {
						list = data; 
						callback(err, data);
					} );
				},
				function(callback) {
					// now load first page in list
					self._listLoadPage(key, list.first_page, 'create', function(err, data) {
						page = data;
						callback(err, data);
					} );
				}
			],
			function(err, results) {
				// list and page loaded, proceed with unshift
				if (err) {
					self._listUnlock(key);
					return callback(err, null);
				}
				
				// populate tasks array with records to save
				var tasks = [];
				
				// split items into pages
				var item = null;
				var count = 0;
				while (item = items.pop()) {
					// make sure item is an object
					if (typeof(item) != 'object') continue;
					
					// if last page is full, we need to create a new one
					if (page.items.length >= list.page_size) {
						// complete current page, queue for save
						if (count) tasks.push({ key: key + '/' + list.first_page, data: page });
						
						// add new page
						list.first_page--;
						page = { type: 'list_page', items: [] };
					}
					
					// push item onto list
					page.items.unshift( item );
					list.length++;
					count++;
				} // foreach item
				
				if (!count) {
					self._listUnlock(key);
					return callback(new Error("No valid objects found to add."), null);
				}
				
				// add current page, and main list record
				tasks.push({ key: key + '/' + list.first_page, data: page });
				tasks.push({ key: key, data: list });
				
				// save all pages and main list
				var lastErr = null;
				var q = async.queue(function (task, callback) {
					self.put( task.key, task.data, callback );
				}, self.concurrency );
				
				q.drain = function() {
					// all pages saved, complete
					self._listUnlock(key);
					callback(lastErr, list);
				};
				
				q.push( tasks, function(err) {
					lastErr = err;
				} );
				
			} ); // loaded
		} ); // locked
	},
	
	listPop: function(key, callback) {
		// Pop last item off end of list, shrink as necessary, return item
		var self = this;
		var list = null;
		var page = null;
		this.logDebug(9, "Popping item off end of list: " + key);
		
		this._listLock( key, true, function() {
			async.series([
				function(callback) {
					// first load list header
					self._listLoad(key, false, function(err, data) {
						list = data; 
						callback(err, data);
					} );
				},
				function(callback) {
					// now load last page in list
					self._listLoadPage(key, list.last_page, false, function(err, data) {
						page = data;
						callback(err, data);
					} );
				}
			],
			function(err, results) {
				// list and page loaded, proceed with pop
				if (err) {
					self._listUnlock(key);
					return callback(err, null);
				}
				if (!page.items.length) {
					self._listUnlock(key);
					return callback( null, null );
				}
				
				var actions = [];
				var item = page.items.pop();
				var old_last_page = list.last_page;
				
				if (!page.items.length) {
					// out of items in this page, delete page, adjust list
					if (list.last_page > list.first_page) {
						list.last_page--;
						
						actions.push( 
							function(callback) { self.delete( key + '/' + old_last_page, callback ); } 
						);
					}
					else {
						// list is empty, create new first page
						actions.push( 
							function(callback) { self.put( key + '/' + old_last_page, { type: 'list_page', items: [] }, callback ); } 
						);
					}
				}
				else {
					// still have items left, save page
					actions.push( 
						function(callback) { self.put( key + '/' + list.last_page, page, callback ); } 
					);
				}
				
				// shrink list
				list.length--;
				actions.push( 
					function(callback) { self.put( key, list, callback ); } 
				);
				
				// save everything in parallel
				async.parallel( actions, function(err, results) {
					// success, fire user callback
					self._listUnlock(key);
					callback(err, err ? null : item);
				} ); // save complete
				
			} ); // loaded
		} ); // locked
	},
	
	listShift: function(key, callback) {
		// Shift first item off beginning of list, shrink as necessary, return item
		var self = this;
		var list = null;
		var page = null;
		this.logDebug(9, "Shifting item off beginning of list: " + key);
		
		this._listLock( key, true, function() {
			async.series([
				function(callback) {
					// first load list header
					self._listLoad(key, false, function(err, data) {
						list = data; 
						callback(err, data);
					} );
				},
				function(callback) {
					// now load first page in list
					self._listLoadPage(key, list.first_page, false, function(err, data) {
						page = data;
						callback(err, data);
					} );
				}
			],
			function(err, results) {
				// list and page loaded, proceed with shift
				if (err) {
					self._listUnlock(key);
					return callback(err, null);
				}
				if (!page.items.length) {
					self._listUnlock(key);
					return callback( null, null );
				}
				
				var actions = [];
				var item = page.items.shift();
				var old_first_page = list.first_page;
				
				if (!page.items.length) {
					// out of items in this page, delete page, adjust list
					if (list.first_page < list.last_page) {
						list.first_page++;
						
						actions.push( 
							function(callback) { self.delete( key + '/' + old_first_page, callback ); } 
						);
					}
					else {
						// list is empty, create new first page
						actions.push( 
							function(callback) { self.put( key + '/' + old_first_page, { type: 'list_page', items: [] }, callback ); } 
						);
					}
				}
				else {
					// still have items left, save page
					actions.push( 
						function(callback) { self.put( key + '/' + list.first_page, page, callback ); } 
					);
				}
				
				// shrink list
				list.length--;
				actions.push( 
					function(callback) { self.put( key, list, callback ); } 
				);
				
				// save everything in parallel
				async.parallel( actions, function(err, results) {
					// success, fire user callback
					self._listUnlock(key);
					callback(err, err ? null : item);
				} ); // save complete
				
			} ); // loaded
		} ); // locked
	},
	
	listGet: function(key, idx, len, callback) {
		// Fetch chunk from list of any size, in any location
		// Use negative idx to fetch from end of list
		var self = this;
		var list = null;
		var page = null;
		var items = [];
		if (!this.started) return callback( new Error("Storage has not completed startup.") );
		
		idx = parseInt( idx || 0 );
		if (isNaN(idx)) return callback( new Error("Position must be an integer.") );
		
		len = parseInt( len || 0 );
		if (isNaN(len)) return callback( new Error("Length must be an integer.") );
		
		this.logDebug(9, "Fetching " + len + " items at position " + idx + " from list: " + key);
		
		async.series([
			function(callback) {
				// first we share lock
				self._listShareLock(key, true, callback);
			},
			function(callback) {
				// next load list header
				self._listLoad(key, false, function(err, data) {
					list = data; 
					callback(err, data);
				} );
			},
			function(callback) {
				// now load first page in list
				self._listLoadPage(key, list.first_page, false, function(err, data) {
					page = data;
					callback(err, data);
				} );
			}
		],
		function(err, results) {
			// list and page loaded, proceed with get
			if (err) {
				self._listShareUnlock(key);
				return callback(err, null, list);
			}
			
			// apply defaults if applicable
			if (!idx) idx = 0;
			if (!len) len = list.length;
			
			// range check
			if (list.length && (idx >= list.length)) {
				self._listShareUnlock(key);
				return callback( new Error("Index out of range"), null, list );
			}
			
			// Allow user to get items from end of list
			if (idx < 0) { idx += list.length; }
			if (idx < 0) { idx = 0; }
			
			if (idx + len > list.length) { len = list.length - idx; }
			
			// First page is special, as it is variably sized
			// and shifts the paging algorithm
			while (idx < page.items.length) {
				items.push( page.items[idx++] );
				len--;
				if (!len) break;
			}
			if (!len || (idx >= list.length)) {
				// all items were on first page, return now
				self._listShareUnlock(key);
				return callback( null, items, list );
			}
			
			// we need items from other pages
			var num_fp_items = page.items.length;
			var chunk_size = list.page_size;
			
			var first_page_needed = list.first_page + 1 + Math.floor((idx - num_fp_items) / chunk_size);
			var last_page_needed = list.first_page + 1 + Math.floor(((idx - num_fp_items) + len - 1) / chunk_size);
			var page_idx = first_page_needed;
			
			async.whilst(
				function() { return page_idx <= last_page_needed; },
				function(callback) {
					self._listLoadPage(key, page_idx, false, function(err, data) {
						if (err) return callback(err);
						var page = data;
						
						var page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
						var local_idx = idx - page_start_idx;
						
						while ((local_idx >= 0) && (local_idx < page.items.length)) {
							items.push( page.items[local_idx++] );
							idx++;
							len--;
							if (!len) break;
						}
						
						if (!len) page_idx = last_page_needed;
						page_idx++;
						callback();
					} );
				},
				function(err) {
					// all pages loaded
					self._listShareUnlock(key);
					if (err) return callback(err, null);
					callback( null, items, list );
				}
			); // pages loaded
		} ); // list loaded
	},
	
	listFind: function(key, criteria, callback) {
		// Find single item in list given criteria -- WARNING: this can be slow with long lists
		var self = this;
		var num_crit = Tools.numKeys(criteria);
		this.logDebug(9, "Locating item in list: " + key, criteria);
		
		this._listShareLock(key, true, function() {
			// share locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listShareUnlock(key);
					return callback(err, null);
				}
				
				var item = null;
				var item_idx = 0;
				var page_idx = list.first_page;
				if (!list.length) {
					self._listShareUnlock(key);
					return callback(null, null);
				}
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						self._listLoadPage(key, page_idx, false, function(err, page) {
							if (err) return callback(err, null);
							// now scan page's items
							for (var idx = 0, len = page.items.length; idx < len; idx++) {
								var matches = 0;
								for (var k in criteria) {
									if (criteria[k].test) {
										if (criteria[k].test(page.items[idx][k])) { matches++; }
									}
									else if (criteria[k] == page.items[idx][k]) { matches++; }
								}
								if (matches == num_crit) {
									// we found our item!
									item = page.items[idx];
									idx = len;
									page_idx = list.last_page;
								}
								else item_idx++;
							} // foreach item
							
							page_idx++;
							callback();
						} ); // page loaded
					},
					function(err) {
						// all pages loaded
						self._listShareUnlock(key);
						if (err) return callback(err, null);
						if (!item) item_idx = -1;
						callback( null, item, item_idx );
					}
				); // whilst
			} ); // loaded
		} ); // _listShareLock
	},
	
	listFindCut: function(key, criteria, callback) {
		// Find single object by criteria, and if found, delete it -- WARNING: this can be slow with long lists
		var self = this;
		
		// This is a two-part macro function, which performs a find followed by a splice,
		// so we need an outer lock that lasts the entire duration of both ops, but we can't collide
		// with the natural lock that splice invokes, so we must add an additional '|' lock prefix.
		
		this._listLock( '|'+key, true, function() {	
			self.listFind(key, criteria, function(err, item, idx) {
				if (err) {
					self._listUnlock( '|'+key );
					return callback(err, null);
				}
				if (!item) {
					self._listUnlock( '|'+key );
					return callback(new Error("Item not found"), null);
				}
				
				self.listSplice(key, idx, 1, null, function(err, items) {
					self._listUnlock( '|'+key );
					callback(err, items ? items[0] : null);
				}); // splice
			} ); // find
		} ); // locked
	},
	
	listFindDelete: function(key, criteria, callback) {
		// alias for listFindCut
		return this.listFindCut(key, criteria, callback);
	},
	
	listFindReplace: function(key, criteria, new_item, callback) {
		// Find single object by criteria, and if found, replace it -- WARNING: this can be slow with long lists
		var self = this;
		
		// This is a two-part macro function, which performs a find followed by a splice,
		// so we need an outer lock that lasts the entire duration of both ops, but we can't collide
		// with the natural lock that splice invokes, so we must add an additional '|' lock prefix.
		
		this._listLock( '|'+key, true, function() {	
			self.listFind(key, criteria, function(err, item, idx) {
				if (err) {
					self._listUnlock( '|'+key );
					return callback(err, null);
				}
				if (!item) {
					self._listUnlock( '|'+key );
					return callback(new Error("Item not found"), null);
				}
				
				self.listSplice(key, idx, 1, [new_item], function(err, items) {
					self._listUnlock( '|'+key );
					callback(err);
				}); // splice
			} ); // find
		} ); // locked
	},
	
	listFindUpdate: function(key, criteria, updates, callback) {
		// Find single object by criteria, and if found, update it -- WARNING: this can be slow with long lists
		// Updates are merged into original item, with numerical increments starting with "+" or "-"
		var self = this;
		
		// This is a two-part macro function, which performs a find followed by a splice,
		// so we need an outer lock that lasts the entire duration of both ops, but we can't collide
		// with the natural lock that splice invokes, so we must add an additional '|' lock prefix.
		
		this._listLock( '|'+key, true, function() {	
			self.listFind(key, criteria, function(err, item, idx) {
				if (err) {
					self._listUnlock( '|'+key );
					return callback(err, null);
				}
				if (!item) {
					self._listUnlock( '|'+key );
					return callback(new Error("Item not found"), null);
				}
				
				// apply updates
				for (var ukey in updates) {
					var uvalue = updates[ukey];
					if ((typeof(uvalue) == 'string') && (typeof(item[ukey]) == 'number') && uvalue.match(/^(\+|\-)([\d\.]+)$/)) {
						var op = RegExp.$1;
						var amt = parseFloat(RegExp.$2);
						if (op == '+') item[ukey] += amt;
						else item[ukey] -= amt;
					}
					else item[ukey] = uvalue;
				}
				
				self.listSplice(key, idx, 1, [item], function(err, items) {
					self._listUnlock( '|'+key );
					callback(err, item);
				}); // splice
			} ); // find
		} ); // locked
	},
	
	listFindEach: function(key, criteria, iterator, callback) {
		// fire iterator for every matching element in list, only load one page at a time
		var self = this;
		var num_crit = Tools.numKeys(criteria);
		this.logDebug(9, "Locating items in list: " + key, criteria);
		
		this._listShareLock(key, true, function() {
			// share locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listShareUnlock(key);
					callback(err);
					return;
				}
				var page_idx = list.first_page;
				var item_idx = 0;
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// load each page
						self._listLoadPage(key, page_idx++, false, function(err, page) {
							if (err) return callback(err);
							
							// iterate over page items
							if (page && page.items && page.items.length) {
								async.eachSeries( page.items, function(item, callback) {
									// for each item, check against criteria
									var matches = 0;
									for (var k in criteria) {
										if (criteria[k].test) {
											if (criteria[k].test(item[k])) { matches++; }
										}
										else if (criteria[k] == item[k]) { matches++; }
									}
									if (matches == num_crit) {
										iterator(item, item_idx++, callback);
									}
									else {
										item_idx++;
										callback();
									}
								}, callback );
							}
							else callback();
						} ); // page loaded
					},
					function(err) {
						// all pages iterated
						self._listShareUnlock(key);
						if (err) return callback(err);
						else callback(null);
					} // pages complete
				); // whilst
			} ); // loaded
		} ); // _listShareLock
	},
	
	listDelete: function(key, entire, callback) {
		// Delete entire list and all pages
		var self = this;
		this.logDebug(9, "Deleting list: " + key);
		
		this._listLock( key, true, function() {
			// locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listUnlock(key);
					return callback(err, null);
				}
				
				var page_idx = list.first_page;
				if (!entire) page_idx++; // skip first page, will be rewritten
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// delete each page
						self.delete( key + '/' + page_idx, function(err, data) {
							page_idx++;
							return callback(err);
						} ); // delete
					},
					function(err) {
						// all pages deleted
						if (err) {
							self._listUnlock(key);
							return callback(err, null);
						}
						
						// delete list itself, or just clear it?
						if (entire) {
							// delete entire list
							self.delete(key, function(err, data) {
								// final delete complete
								self._listUnlock(key);
								callback(err);
							} ); // deleted
						} // entire
						else {
							// zero list for reuse
							list.length = 0;
							list.first_page = 0;
							list.last_page = 0;
							
							self.put( key, list, function(err, data) {
								// finished saving list header
								if (err) {
									self._listUnlock(key);
									return callback(err);
								}
								
								// now save a blank first page
								self.put( key + '/0', { type: 'list_page', items: [] }, function(err, data) {
									// save complete
									self._listUnlock(key);
									callback(err);
								} ); // saved
							} ); // saved header
						} // reuse
					} // pages deleted
				); // whilst
			} ); // loaded
		} ); // locked
	},
	
	listGetInfo: function(key, callback) {
		// Return info about list (number of items, etc.)
		this._listLoad( key, false, callback );
	},
	
	listCopy: function(old_key, new_key, callback) {
		// Copy list to new path (and all pages)
		var self = this;
		this.logDebug(9, "Copying list: " + old_key + " to " + new_key);
		
		this._listLoad(old_key, false, function(err, list) {
			// list loaded, proceed
			if (err) {
				callback(err);
				return;
			}
			var page_idx = list.first_page;
			
			async.whilst(
				function() { return page_idx <= list.last_page; },
				function(callback) {
					// load each page
					self._listLoadPage(old_key, page_idx, false, function(err, page) {
						if (err) return callback(err);
						
						// and copy it
						self.copy( old_key + '/' + page_idx, new_key + '/' + page_idx, function(err, data) {
							page_idx++;
							return callback(err);
						} ); // copy
					} ); // page loaded
				},
				function(err) {
					// all pages copied
					if (err) return callback(err);
					
					// now copy list header
					self.copy(old_key, new_key, function(err, data) {
						// final copy complete
						callback(err);
					} ); // deleted
				} // pages copied
			); // whilst
		} ); // loaded
	},
	
	listRename: function(old_key, new_key, callback) {
		// Copy, then delete list (and all pages)
		var self = this;
		this.logDebug(9, "Renaming list: " + old_key + " to " + new_key);
		
		this.listCopy( old_key, new_key, function(err) {
			// copy complete, now delete old list
			if (err) return callback(err);
			
			self.listDelete( old_key, true, callback );
		} ); // copied
	},
	
	listEach: function(key, iterator, callback) {
		// fire iterator for every element in list, only load one page at a time
		var self = this;
		
		this._listShareLock(key, true, function() {
			// share locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listShareUnlock(key);
					callback(err);
					return;
				}
				var page_idx = list.first_page;
				var item_idx = 0;
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// load each page
						self._listLoadPage(key, page_idx++, false, function(err, page) {
							if (err) return callback(err);
							
							// iterate over page items
							if (page && page.items && page.items.length) {
								async.eachSeries( page.items, function(item, callback) {
									iterator(item, item_idx++, callback);
								}, callback );
							}
							else callback();
						} ); // page loaded
					},
					function(err) {
						// all pages iterated
						self._listShareUnlock(key);
						if (err) return callback(err);
						else callback(null);
					} // pages complete
				); // whilst
			} ); // loaded
		} ); // _listShareLock
	},
	
	listEachPage: function(key, iterator, callback) {
		// fire iterator for every page in list
		var self = this;
		
		this._listShareLock(key, true, function() {
			// share locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listShareUnlock(key);
					callback(err);
					return;
				}
				var page_idx = list.first_page;
				var item_idx = 0;
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// load each page
						self._listLoadPage(key, page_idx++, false, function(err, page) {
							if (err) return callback(err);
							
							// call iterator for page items
							if (page && page.items && page.items.length) {
								iterator(page.items, callback);
							}
							else callback();
						} ); // page loaded
					},
					function(err) {
						// all pages iterated
						self._listShareUnlock(key);
						callback( err || null );
					} // pages complete
				); // whilst
			} ); // loaded
		} ); // _listShareLock
	},
	
	listEachUpdate: function(key, iterator, callback) {
		// fire iterator for every element in list, only load one page at a time
		// iterator can signal that a change was made to any items, triggering an update
		var self = this;
		
		this._listLock(key, true, function() {
			// exclusively locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listUnlock(key);
					callback(err);
					return;
				}
				var page_idx = list.first_page;
				var item_idx = 0;
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// load each page
						var page_key = key + '/' + page_idx;
						
						self._listLoadPage(key, page_idx++, false, function(err, page) {
							if (err) return callback(err);
							
							// iterate over page items
							if (page && page.items && page.items.length) {
								var num_updated = 0;
								
								async.eachSeries( page.items, 
									function(item, callback) {
										iterator(item, item_idx++, function(err, updated) {
											if (updated) num_updated++;
											callback(err);
										});
									}, 
									function(err) {
										if (err) return callback(err);
										if (num_updated) self.put( page_key, page, callback );
										else callback();
									}
								); // async.eachSeries
							}
							else callback();
						} ); // page loaded
					},
					function(err) {
						// all pages iterated
						self._listUnlock(key);
						callback( err || null );
					} // pages complete
				); // whilst
			} ); // loaded
		} ); // _listLock
	},
	
	listEachPageUpdate: function(key, iterator, callback) {
		// fire iterator for every page in list
		// iterator can signal that a change was made to any page, triggering an update
		var self = this;
		
		this._listLock(key, true, function() {
			// exclusively locked
			self._listLoad(key, false, function(err, list) {
				// list loaded, proceed
				if (err) {
					self._listUnlock(key);
					callback(err);
					return;
				}
				var page_idx = list.first_page;
				var item_idx = 0;
				
				async.whilst(
					function() { return page_idx <= list.last_page; },
					function(callback) {
						// load each page
						var page_key = key + '/' + page_idx;
						
						self._listLoadPage(key, page_idx++, false, function(err, page) {
							if (err) return callback(err);
							
							// call iterator for page items
							if (page && page.items && page.items.length) {
								iterator(page.items, function(err, updated) {
									if (!err && updated) self.put( page_key, page, callback );
									else callback(err);
								});
							}
							else callback();
						} ); // page loaded
					},
					function(err) {
						// all pages iterated
						self._listUnlock(key);
						callback( err || null );
					} // pages complete
				); // whilst
			} ); // loaded
		} ); // _listLock
	},
	
	listInsertSorted: function(key, insert_item, comparator, callback) {
		// insert item into list while keeping it sorted
		var self = this;
		var loc = false;
		
		if (isArray(comparator)) {
			// convert to closure
			var sort_key = comparator[0];
			var sort_dir = comparator[1] || 1;
			comparator = function(a, b) {
				return( ((a[sort_key] < b[sort_key]) ? -1 : 1) * sort_dir );
			};
		}
		
		// This is a two-part macro function, which performs a find followed by a splice,
		// so we need an outer lock that lasts the entire duration of both ops, but we can't collide
		// with the natural lock that splice invokes, so we must add an additional '|' lock prefix.
		
		this._listLock( '|'+key, true, function() {	
			// list is locked
			self.listEach( key, 
				function(item, idx, callback) {
					// listEach iterator
					var result = comparator(insert_item, item);
					if (result < 0) {
						// our item should come before compared item, so splice here!
						loc = idx;
						callback("break");
					}
					else callback();
				}, // listEach iterator
				function(err) {
					// listEach complete
					// Ignoring error here, as we'll just create a new list
					
					if (loc !== false) {
						// found location, so perform non-removal splice
						self.listSplice( key, loc, 0, [insert_item], function(err) {
							self._listUnlock( '|'+key );
							callback(err);
						} );
					}
					else {
						// no suitable location found, so add to end of list
						self.listPush( key, insert_item, function(err) {
							self._listUnlock( '|'+key );
							callback(err);
						} );
					}
				} // listEach complete
			); // listEach
		} ); // list locked
	}
	
});
