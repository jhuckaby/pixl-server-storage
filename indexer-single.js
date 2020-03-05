// PixlServer Storage System - Indexer Single Search Mixin
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

// These methods implement a searchRecords-like API, but only run a query on a single record at a time.
// This is used for things like real-time searches (views), where a single updated record is 
// re-evaluated to see if it should be added/removed to a live search result set.

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	searchSingle: function(query, record_id, config, callback) {
		// run search query on single record
		// load record idx_data
		var self = this;
		
		// parse search string if required
		if (typeof(query) == 'string') {
			query = query.trim();
			
			if (query == '*') {
				// search wildcard -- special instant result of always true
				return callback(null, true);
			}
			else if (query.match(/^\([\s\S]+\)$/)) {
				// PxQL syntax, parse grammar
				query = this.parseGrammar(query, config);
				if (query.err) {
					this.logError('index', "Invalid search query: " + query.err, query);
					return callback(query.err, false);
				}
			}
			else {
				// simple query syntax
				query = this.parseSearchQuery(query, config);
			}
		}
		
		if (!query.criteria || !query.criteria.length) {
			this.logError('index', "Invalid search query", query);
			return callback(null, false);
		}
		
		this.get( config.base_path + '/_data/' + record_id, function(err, idx_data) {
			if (err) return callback(err);
			
			var results = self._searchSingle(query, record_id, idx_data, config);
			callback( null, !!results[record_id] );
		});
	},
	
	_searchSingle: function(query, record_id, idx_data, config) {
		// execute single search on idx_data (sync)
		// query must be pre-compiled and idx_data must be pre-loaded
		var self = this;
		
		// prep idx_data, but only once
		if (!idx_data.hashed) {
			for (var def_id in idx_data) {
				var data = idx_data[def_id];
				data.word_hash = this.getWordHashFromList( data.words || [] );
			}
			idx_data.hashed = true;
		}
		
		var state = query;
		state.config = config;
		state.record_ids = Object.create(null);
		state.first = true;
		
		// first, split criteria into subs (sub-queries), 
		// stds (standard queries) and negs (negative queries)
		var subs = [], stds = [], negs = [];
		for (var idx = 0, len = query.criteria.length; idx < len; idx++) {
			var crit = query.criteria[idx];
			if (crit.criteria) subs.push( crit );
			else {
				var def = Tools.findObject( config.fields, { id: crit.index } );
				if (!def) {
					this.logError('index', "Invalid search query: Index not found: " + crit.index, query);
					return {};
				}
				crit.def = def;
				
				if (crit.negative) negs.push( crit );
				else stds.push( crit );
			}
		}
		
		// generate series of tasks, starting with any sub-queries,
		// then standard positive criteria, then negative criteria
		var tasks = [].concat( subs, stds, negs );
		
		tasks.forEach( function(task) {
			if (task.criteria) {
				// sub-query
				var records = self._searchSingle( task, record_id, idx_data, config );
				self.mergeIndex( state.record_ids, records, state.first ? 'or' : state.mode );
				state.first = false;
			}
			else if (task.skip) {
				// skip this task (all words removed)
			}
			else if (task.def.type) {
				// custom index type, e.g. date, time, number
				var func = 'searchSingle_' + task.def.type;
				if (self[func]) self[func]( task, record_id, idx_data, state );
				else self.logError('index', "Unknown index type: " + task.def.type);
			}
			else if (task.literal) {
				self._searchSingleWordIndexLiteral(task, record_id, idx_data, state);
			}
			else {
				self._searchSingleWordIndex(task, record_id, idx_data, state);
			}
		} ); // foreach task
		
		return state.record_ids;
	},
	
	_searchSingleWordIndex: function(query, record_id, idx_data, state) {
		// run one search query (list of words against one index)
		var self = this;
		var config = state.config;
		var def = query.def;
		
		var mode = state.first ? 'or' : state.mode;
		if (query.negative) mode = 'not';
		state.first = false;
		
		var cur_items = state.record_ids;
		var new_items = Object.create(null);
		
		// create "fake" hash index for word, containing only our one record
		var items = Object.create(null);
		if (idx_data[def.id] && idx_data[def.id].word_hash && idx_data[def.id].word_hash[query.word]) {
			items[ record_id ] = idx_data[def.id].word_hash[query.word];
		}
		
		switch (mode) {
			case 'and':
				for (var key in items) {
					if (key in cur_items) new_items[key] = 1;
				}
			break;
			
			case 'or':
				for (var key in items) {
					cur_items[key] = 1;
				}
			break;
			
			case 'not':
				for (var key in items) {
					delete cur_items[key];
				}
			break;
		}
		
		if (mode == 'and') state.record_ids = new_items;
	},
	
	_searchSingleWordIndexLiteral: function(query, record_id, idx_data, state) {
		// run literal search query (list of words which must be in sequence)
		var self = this;
		var def = query.def;
		
		var mode = state.first ? 'or' : state.mode;
		if (query.negative) mode = 'not';
		state.first = false;
		
		var record_ids = state.record_ids;
		var temp_results = Object.create(null);
		var temp_idx = 0;
		
		query.words.forEach( function(word) {
			// for each word, iterate over record ids
			var keepers = Object.create(null);
			
			// create "fake" hash index for word, containing only our one record
			var items = Object.create(null);
			if (idx_data[def.id] && idx_data[def.id].word_hash && idx_data[def.id].word_hash[word]) {
				items[ record_id ] = idx_data[def.id].word_hash[word];
			}
			
			Object.keys(items).forEach( function(record_id) {
				var raw_value = items[record_id];
				
				// instant rejection if temp_idx and record_id isn't already present
				if (temp_idx && !(record_id in temp_results)) return;
				
				var offset_list = raw_value.split(/\,/);
				var still_good = 0;
				
				for (var idx = offset_list.length - 1; idx >= 0; idx--) {
					var word_idx = parseInt( offset_list[idx] );
					
					if (temp_idx) {
						// Subsequent pass -- make sure offsets are +1
						var arr = temp_results[record_id];
						for (var idy = 0, ley = arr.length; idy < ley; idy++) {
							var elem = arr[idy];
							if (word_idx == elem + 1) {
								arr[idy]++;
								still_good = 1;
							}
						}
					} // temp_idx
					else {
						// First pass -- get word idx into temp_results
						if (!temp_results[record_id]) temp_results[record_id] = [];
						temp_results[record_id].push( word_idx );
						still_good = 1;
					}
				} // foreach word_idx
				
				if (!still_good) delete temp_results[record_id];
				else keepers[record_id] = 1;
			} ); // foreach fake hash key
			
			// If in a subsequent word pass, make sure all temp_results
			// ids are still matched in the latest word
			if (temp_idx > 0) self.mergeIndex( temp_results, keepers, 'and' );
			temp_idx++;
		} ); // foreach word
		
		// all done, now merge data into record ids
		for (var record_id in temp_results) {
			temp_results[record_id] = 1; // cleanup values
		}
		
		this.mergeIndex( record_ids, temp_results, mode );
	}
	
});
