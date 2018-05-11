// PixlServer Storage System - List Splice Mixin
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

// support for older node versions
var isArray = Array.isArray || util.isArray;

module.exports = Class.create({
	
	listSplice: function(key, idx, len, new_items, callback) {
		// Cut any size chunk out of list, optionally replacing it with a new chunk of any size
		var self = this;
		if (!new_items) new_items = [];
		if (!isArray(new_items)) new_items = [new_items];
		var num_new = new_items.length;
		
		idx = parseInt( idx || 0 );
		if (isNaN(idx)) return callback( new Error("Position must be an integer.") );
		
		len = parseInt( len || 0 );
		if (isNaN(len)) return callback( new Error("Length must be an integer.") );
		
		this.logDebug(9, "Splicing " + len + " items at position " + idx + " in list: " + key, this.debugLevel(10) ? new_items : null);
		
		this._listLock( key, true, function() {
			// locked
			self._listLoad(key, false, function(err, list) {
				// check for error
				if (err) {
					self._listUnlock(key);
					return callback(err);
				}
				
				// Manage bounds, allow negative
				if (idx < 0) { idx += list.length; }
				// if (!len) { len = list.length - idx; }
				if (idx + len > list.length) { len = list.length - idx; }
				
				// bounds check
				if ((idx < 0) || (idx > list.length)) {
					self._listUnlock(key);
					return callback( new Error("List index out of bounds.") );
				}
				
				if (!len && !num_new) {
					// nothing to cut, nothing to insert, so we're already done
					self._listUnlock(key);
					return callback(null, []);
				}
				if (!len && (idx == list.length)) {
					// nothing to cut and idx is at the list end, so push instead
					self._listUnlock(key);
					return self.listPush( key, new_items, function(err) { callback(err, []); } );
				}
				if (!len && !idx) {
					// nothing to cut and idx is at the list beginning, so unshift instead
					self._listUnlock(key);
					return self.listUnshift( key, new_items, function(err) { callback(err, []); } );
				}
				
				if (!idx && list.length && (len == list.length) && !num_new) {
					// special case: cutting ALL items from list, and not replacing any
					// need to create a proper empty list, and return the items
					self._listUnlock(key);
					self.listGet( key, idx, len, function(err, items) {
						if (err) return callback(err);
						
						self.listDelete( key, false, function(err) {
							if (err) return callback(err);
							callback(null, items);
						} );
					} );
					return;
				}
				
				var complete = function(err, cut_items) {
					// finally, save list metadata
					if (err) {
						self._listUnlock(key);
						return callback(err, null);
					}
					
					self.put( key, list, function(err, data) {
						self._listUnlock(key);
						if (err) return callback(err, null);
						
						// success, return spliced items
						callback(null, cut_items);
					} );
				};
				
				// jump to specialized method for splice type
				var right_side = !!(idx + (len / 2) >= list.length / 2);
				var cut_func = right_side ? "_listCutRight" : "_listCutLeft";
				var ins_func = right_side ? "_listInsertRight" : "_listInsertLeft";
				
				if (num_new == len) {
					// simple replace
					self._listSpliceSimple( list, key, idx, len, new_items, complete );
				}
				else if (len) {
					// cut first, then maybe insert
					self[cut_func]( list, key, idx, len, function(err, cut_items) {
						if (err) return complete(err);
						
						// done with cut, now insert?
						if (num_new) {
							self[ins_func]( list, key, idx, new_items, function(err) {
								// insert complete
								return complete(err, cut_items);
							} ); // ins_func
						} // num_new
						else {
							// no insert needed, cut only
							complete(err, cut_items);
						}
					} ); // cut_func
				}
				else {
					// insert only
					self[ins_func]( list, key, idx, new_items, function(err) {
						// insert complete
						return complete(err, []);
					} ); // ins_func
				}
				
			} ); // loaded
		} ); // locked
	},
	
	_listSpliceSimple: function(list, key, idx, len, new_items, callback) {
		// perform simple list splice where replacement is the same length as the cut
		// i.e. list doesn't have to grow or shrink
		var self = this;
		var page_idx = list.first_page;
		var chunk_size = list.page_size;
		var num_fp_items = 0;
		var cut_items = [];
		
		this.logDebug(9, "Performing simple splice", { key: key, idx: idx, cut: len, add: new_items.length, list: list });
		
		async.whilst(
			function() { return page_idx <= list.last_page; },
			function(callback) {
				self._listLoadPage(key, page_idx, false, function(err, page) {
					if (err) return callback(err);
					
					var page_key = key + '/' + page_idx;
					var page_start_idx = 0;
					
					if (page_idx == list.first_page) {
						num_fp_items = page.items.length;
						if (idx >= num_fp_items) {
							// find page we need to jump to
							page_idx = list.first_page + 1 + Math.floor((idx - num_fp_items) / chunk_size);
							return callback(null);
						}
					} // first page
					else {
						page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
					}
					
					var local_idx = idx - page_start_idx;
					
					while (len && (local_idx >= 0) && (local_idx < page.items.length)) {
						cut_items.push( page.items[local_idx] );
						page.items[local_idx++] = new_items.shift();
						idx++;
						len--;
					}
					
					if (!len) page_idx = list.last_page;
					page_idx++;
					
					self.put( page_key, page, callback );
				} );
			},
			function(err) {
				// all pages updated
				if (err) return callback(err, null);
				callback( null, cut_items );
			}
		); // pages loaded
	},
	
	_listCutRight: function(list, key, idx, len, callback) {
		// perform list cut on the "right" side (from last_page inward)
		var self = this;
		var page_idx = list.first_page;
		var chunk_size = list.page_size;
		var delta = 0 - len; // will be negative
		var num_fp_items = 0;
		var cut_items = [];
		var page_cache = [];
		
		this.logDebug(9, "Performing right-side cut", { key: key, idx: idx, cut: len, list: list });
		
		async.whilst(
			function() { return page_idx <= list.last_page; },
			function(callback) {
				self._listLoadPage(key, page_idx, true, function(err, page) {
					if (err) return callback(err);
					
					var page_key = key + '/' + page_idx;
					var page_start_idx = 0;
					
					if (page_idx == list.first_page) {
						num_fp_items = page.items.length;
						if (idx >= num_fp_items) {
							// find page we need to jump to
							page_idx = list.first_page + 1 + Math.floor((idx - num_fp_items) / chunk_size);
							return callback(null);
						}
					} // first page
					else {
						page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
					}
					
					var local_idx = idx - page_start_idx;
					
					// cut mode
					while (len && (local_idx >= 0) && (local_idx < page.items.length)) {
						cut_items.push( page.items[local_idx] );
						page.items.splice( local_idx, 1 );
						idx++;
						len--;
					}
					
					// fill gaps
					var cidx = 0;
					while (!len && page.items.length && (cidx < page_cache.length)) {
						while (!len && page.items.length && (page_cache[cidx].page.items.length < chunk_size)) {
							page_cache[cidx].page.items.push( page.items.shift() );
						}
						cidx++;
					}
					
					// add current page to write cache
					page_cache.push({
						page_idx: page_idx,
						page_key: page_key,
						page: page
					});
					
					// advance page
					page_idx++;
					
					// eject page from cache if full and ready to write
					if (page_cache.length && (page_cache[0].page.items.length == chunk_size)) {
						var cpage = page_cache.shift();
						self.put( cpage.page_key, cpage.page, callback );
					}
					else callback();
				} );
			},
			function(err) {
				// all pages updated
				if (err) return callback(err, null);
				
				// write all remaining cache entries
				async.eachLimit(page_cache, self.concurrency, 
					function(cpage, callback) {
						// iterator for each page
						if (cpage.page.items.length || (list.first_page == list.last_page)) {
							self.put( cpage.page_key, cpage.page, callback );
						}
						else {
							// delete page
							list.last_page--;
							self.delete( cpage.page_key, callback );
						}
					}, 
					function(err) {
						// all pages stored
						list.length += delta; // will be negative
						callback( null, cut_items );
					}
				); // eachLimit
			} // all pages complete
		); // pages loaded
	},
	
	_listCutLeft: function(list, key, idx, len, callback) {
		// perform list cut on the "left" side (from first_page inward)
		var self = this;
		var page_idx = list.last_page;
		var chunk_size = list.page_size;
		var delta = 0 - len; // will be negative
		var num_fp_items = 0;
		var num_lp_items = 0;
		var cut_items = [];
		var page_cache = [];
		
		this.logDebug(9, "Performing left-side cut", { key: key, idx: idx, cut: len, list: list });
		
		idx += (len - 1);
		var ridx = (list.length - 1) - idx;
		
		async.whilst(
			function() { return page_idx >= list.first_page; },
			function(callback) {
				self._listLoadPage(key, page_idx, true, function(err, page) {
					if (err) return callback(err);
					
					var page_key = key + '/' + page_idx;
					var page_start_idx = 0;
					
					if (page_idx == list.last_page) {
						num_lp_items = page.items.length;
						if (list.last_page == list.first_page) num_fp_items = num_lp_items;
						else {
							num_fp_items = ((list.length - num_lp_items) % chunk_size) || chunk_size;
						}
						if (ridx >= num_lp_items) {
							// find page we need to jump to
							page_idx = (list.last_page - 1) - Math.floor((ridx - num_lp_items) / chunk_size);
							return callback(null);
						}
					} // last page
					
					if (page_idx != list.first_page) {
						page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
					}
					
					var local_idx = idx - page_start_idx;
					
					// cut mode
					while (len && (local_idx >= 0) && (local_idx < page.items.length)) {
						cut_items.unshift( page.items[local_idx] );
						page.items.splice( local_idx--, 1 );
						idx--;
						len--;
					}
					
					// fill gaps
					var cidx = 0;
					while (!len && page.items.length && (cidx < page_cache.length)) {
						while (!len && page.items.length && (page_cache[cidx].page.items.length < chunk_size)) {
							page_cache[cidx].page.items.unshift( page.items.pop() );
						}
						cidx++;
					}
					
					// add current page to write cache
					page_cache.push({
						page_idx: page_idx,
						page_key: page_key,
						page: page
					});

					// advance page
					page_idx--;
					
					// eject page from cache if full and ready to write
					if (page_cache.length && (page_cache[0].page.items.length == chunk_size)) {
						var cpage = page_cache.shift();
						self.put( cpage.page_key, cpage.page, callback );
					}
					else callback();
				} );
			},
			function(err) {
				// all pages updated
				if (err) return callback(err, null);
				
				// write all remaining cache entries
				async.eachLimit(page_cache, self.concurrency, 
					function(cpage, callback) {
						// iterator for each page
						if (cpage.page.items.length || (list.first_page == list.last_page)) {
							self.put( cpage.page_key, cpage.page, callback );
						}
						else {
							// delete page
							list.first_page++;
							self.delete( cpage.page_key, callback );
						}
					}, 
					function(err) {
						// all pages stored
						list.length += delta; // will be negative
						callback( null, cut_items );
					}
				); // eachLimit
			} // all pages complete
		); // pages loaded
	},
	
	_listInsertRight: function(list, key, idx, new_items, callback) {
		// perform list insert on the "right" side (expand towards last_page)
		var self = this;
		var page_idx = list.first_page;
		var chunk_size = list.page_size;
		var delta = new_items.length;
		var num_fp_items = 0;
		var buffer = [];
		
		this.logDebug(9, "Performing right-side insert", { key: key, idx: idx, add: delta, list: list });
		
		async.whilst(
			function() { return page_idx <= list.last_page; },
			function(callback) {
				self._listLoadPage(key, page_idx, true, function(err, page) {
					if (err) return callback(err);
					
					var page_key = key + '/' + page_idx;
					var page_start_idx = 0;
					
					if (page_idx == list.first_page) {
						num_fp_items = page.items.length;
						if (num_fp_items && (idx >= num_fp_items)) {
							// find page we need to jump to
							page_idx = list.first_page + 1 + Math.floor((idx - num_fp_items) / chunk_size);
							
							// this may be an end-of-list insert, in which case we have to short circuit the page jump
							if (page_idx > list.last_page) page_idx = list.last_page;
							if (page_idx != list.first_page) return callback(null);
						}
					} // first page
					else {
						page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
					}
					
					var local_idx = idx - page_start_idx;
					
					if (new_items.length) {
						// insert mode
						var orig_items_len = page.items.length;
						while (new_items.length && (local_idx >= 0) && (local_idx < chunk_size)) {
							if (local_idx < orig_items_len) buffer.push( page.items[local_idx] );
							page.items[local_idx++] = new_items.shift();
							idx++;
						}
					}
					
					// cleanup mode
					if (!new_items.length && buffer.length && (local_idx >= 0) && (local_idx < chunk_size)) {
						
						// page.items.splice( local_idx, 0, buffer );
						buffer.unshift( local_idx, 0 );
						[].splice.apply( page.items, buffer );
						
						if (page.items.length > chunk_size) buffer = page.items.splice(chunk_size);
						else buffer = [];
						idx = page_start_idx + page.items.length;
					}
					
					if (page_idx == list.first_page) num_fp_items = page.items.length;
					
					page_idx++;
					if ((page_idx > list.last_page) && (new_items.length || buffer.length)) {
						// extend list by a page
						list.last_page = page_idx;
					}
					
					self.put( page_key, page, callback );
				} );
			},
			function(err) {
				// all pages updated
				if (err) return callback(err, null);
				list.length += delta;
				callback( null );
			}
		); // pages loaded
	},
	
	_listInsertLeft: function(list, key, idx, new_items, callback) {
		// perform list insert on the "left" side (expand towards first_page)
		var self = this;
		var page_idx = list.last_page;
		var chunk_size = list.page_size;
		var delta = new_items.length;
		var num_fp_items = 0;
		var num_lp_items = 0;
		var num_new_pages = 0;
		var buffer = [];
		
		this.logDebug(9, "Performing left-side insert", { key: key, idx: idx, add: delta, list: list });
		
		idx--;
		var ridx = (list.length - 1) - idx;
		
		async.whilst(
			function() { 
				return( (page_idx >= list.first_page) || new_items.length || buffer.length ); 
			},
			function(callback) {
				self._listLoadPage(key, page_idx, true, function(err, page) {
					if (err) return callback(err);
					
					var page_key = key + '/' + page_idx;
					var page_start_idx = 0;
					
					if (page_idx == list.last_page) {
						num_lp_items = page.items.length;
						if (list.last_page == list.first_page) num_fp_items = num_lp_items;
						else {
							num_fp_items = ((list.length - num_lp_items) % chunk_size) || chunk_size;
						}
						if (num_lp_items && (ridx >= num_lp_items)) {
							// find page we need to jump to
							page_idx = (list.last_page - 1) - Math.floor((ridx - num_lp_items) / chunk_size);
							
							// this may be an start-of-list insert, in which case we have to short circuit the page jump
							if (page_idx < list.first_page) page_idx = list.first_page;
							if (page_idx != list.last_page) return callback(null);
						}
					} // last page
					
					if (page_idx != list.first_page) {
						page_start_idx = num_fp_items + ((page_idx - list.first_page - 1) * chunk_size);
					}
					
					var local_idx = idx - page_start_idx;
					if (local_idx >= page.items.length) local_idx = page.items.length - 1;
					
					if (new_items.length) {
						// insert mode
						while (new_items.length) {
							if (local_idx >= 0) {
								buffer.unshift( page.items[local_idx] );
								page.items[local_idx--] = new_items.pop();
							}
							else if (page.items.length < chunk_size) {
								page.items.unshift( new_items.pop() );
							}
							else break;
							idx--;
						}
					}
					
					// cleanup mode
					if (!new_items.length && buffer.length && (local_idx >= -1) && (local_idx < chunk_size)) {
						
						// page.items.splice( local_idx + 1, 0, buffer );
						buffer.unshift( local_idx + 1, 0 );
						[].splice.apply( page.items, buffer );
						
						if (page.items.length > chunk_size) buffer = page.items.splice( 0, page.items.length - chunk_size );
						else buffer = [];
						// idx = page_start_idx - 1;
					}
					idx = page_start_idx - 1;
					
					if (page_idx == list.first_page) num_fp_items = page.items.length;
					if (page_idx == list.last_page) num_lp_items = page.items.length;
					
					page_idx--;
					if ((page_idx < list.first_page) && (new_items.length || buffer.length)) {
						// extend list by a page
						num_new_pages++;
					}
					
					self.put( page_key, page, callback );
				} );
			},
			function(err) {
				// all pages updated
				if (err) return callback(err, null);
				list.first_page -= num_new_pages;
				list.length += delta;
				callback( null );
			}
		); // pages loaded
	}
	
});
