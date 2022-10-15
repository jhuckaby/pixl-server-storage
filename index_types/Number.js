// PixlServer Storage System - Number Index Type Mixin
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

// A "Number" is a compound word index, where the value is split into multiple buckets (powers of 10)
// Example, 1536 is indexed as: 1536, T1000, H1500
// Another example: 5 is indexed as: 5, T0, H0
// This currently only works for integers, and is not very efficient for large numbers.
// This is better suited for counting smaller things, like the number of comments or 'likes' on a record.

// Number Ranges are queried by loading the summary (master_list) and OR'ing in 
// all records in relevant buckets.

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

var NUMBER_INDEX_MIN = -1000000;
var NUMBER_INDEX_MAX = 1000000;

// utility
var parseNumber = function(str) {
	// parse number, H# or T# keys
	var args = {};
	if (str.match(/^(N?)(\d+)$/)) {
		var neg = !!RegExp.$1;
		var value = parseInt( RegExp.$2 );
		args.value = value * (neg ? -1 : 1);
		args.tvalue = Math.floor( Math.floor(value / 1000) * 1000 ) * (neg ? -1 : 1);;
		args.hvalue = Math.floor( Math.floor(value / 100) * 100 ) * (neg ? -1 : 1);;
		args.exact = 1;
	}
	else if (str.match(/^H(N?)(\d+)$/)) {
		var neg = !!RegExp.$1;
		var value = parseInt( RegExp.$2 ) * (neg ? -1 : 1);
		args.hvalue = value;
		args.hundreds = 1;
	}
	else if (str.match(/^T(N?)(\d+)$/)) {
		var neg = !!RegExp.$1;
		var value = parseInt( RegExp.$2 ) * (neg ? -1 : 1);
		args.tvalue = value;
		args.thousands = 1;
	}
	else args = null;
	return args;
};

module.exports = Class.create({
	
	prepIndex_number: function(words, def, state) {
		// prep index write for number type
		var value = words[0] || '';
		words = [];
		
		// numbers always require a master_list (summary)
		def.master_list = 1;
		
		if (value.match(/^(N?)(\d+)$/i)) {
			var neg = RegExp.$1.toUpperCase();
			var value = Math.floor( parseInt( RegExp.$2 ) * (def.multiply || 1) / (def.divide || 1) );
			value = Math.min( NUMBER_INDEX_MAX, value );
			
			var tkey = 'T' + neg + Math.floor( Math.floor(value / 1000) * 1000 );
			var hkey = 'H' + neg + Math.floor( Math.floor(value / 100) * 100 );
			
			words.push( neg + value );
			words.push( hkey );
			words.push( tkey );
			
			return words;
		}
		else return false;
	},
	
	prepDeleteIndex_number: function(words, def, state) {
		// prep for index delete (no return value)
		
		// numbers require a master_list (summary)
		def.master_list = 1;
	},
	
	filterWords_number: function(value) {
		// filter number queries
		value = value.replace(/[^\d\-]+/g, '').replace(/\-/, 'N');
		return value;
	},
	
	searchIndex_number: function(query, state, callback) {
		// search number index
		var self = this;
		var record_ids = state.record_ids;
		var word = query.word;
		var base_path = state.config.base_path + '/' + query.def.id;
		var sum_path = base_path + '/summary';
		var temp_results = {};
		var words = [];
		
		if (!query.operator) query.operator = '=';
		
		this.logDebug(10, "Running number query", query);
		
		// clean number up
		word = word.replace(/^N/i, '-').replace(/[^\d\-]+/g, '');
		word = '' + Math.min( NUMBER_INDEX_MAX, Math.max( NUMBER_INDEX_MIN, Math.floor( parseInt(word) * (query.def.multiply || 1) / (query.def.divide || 1) ) ) );
		word = word.replace(/\-/, 'N');
		query.word = word;
		
		// syntax check
		var num = parseNumber(word);
		if (!num) {
			return callback( new Error("Invalid number format: " + word) );
		}
		
		// check for simple equals
		if (query.operator == '=') {
			return this.searchWordIndex(query, state, callback);
		}
		
		// load index summary for list of all populated numbers
		var nspf = state.perf.begin('number_summary');
		this.get( sum_path, function(err, summary) {
			nspf.end();
			if (err || !summary) {
				summary = { id: query.def.id, values: {} };
			}
			var values = summary.values;
			var lesser = !!query.operator.match(/</);
			
			// operator includes exact match
			if (query.operator.match(/=/)) words.push( word );
			
			// add matching number tags based on operator
			for (var value in values) {
				var temp = parseNumber(value) || {};
				if (temp.exact) {
					// only compare if T and H match
					if (temp.hvalue == num.hvalue) {
						if (lesser) { if (temp.value < num.value) words.push(value); }
						else { if (temp.value > num.value) words.push(value); }
					}
				}
				else if (temp.hundreds) {
					if (lesser) { if (temp.hvalue < num.hvalue) words.push(value); }
					else { if (temp.hvalue > num.hvalue) words.push(value); }
				}
				else if (temp.thousands) {
					if (lesser) { if (temp.tvalue < num.tvalue) words.push(value); }
					else { if (temp.tvalue > num.tvalue) words.push(value); }
				}
			}
			
			// now perform OR search for all applicable words
			var nrpf = state.perf.begin('number_range');
			async.eachLimit( words, self.concurrency,
				function(word, callback) {
					// for each word, iterate over record ids
					self.hashEachPage( base_path + '/word/' + word,
						function(items, callback) {
							for (var record_id in items) temp_results[record_id] = 1;
							callback();
						},
						callback
					); // hashEachPage
				},
				function(err) {
					// all done, perform final merge
					nrpf.end();
					state.perf.count('number_buckets', words.length);
					if (err) return callback(err);
					self.mergeIndex( record_ids, temp_results, state.first ? 'or' : state.mode );
					state.first = false;
					callback();
				}
			); // eachSeries
		} ); // get (summary)
	},
	
	searchSingle_number: function(query, record_id, idx_data, state) {
		// search number index vs single record (sync)
		var self = this;
		var record_ids = state.record_ids;
		var word = query.word;
		var temp_results = {};
		var words = [];
		var def = query.def;
		
		if (!query.operator) query.operator = '=';
		
		// clean number up
		word = word.replace(/^N/i, '-').replace(/[^\d\-]+/g, '');
		word = '' + Math.min( NUMBER_INDEX_MAX, Math.max( NUMBER_INDEX_MIN, Math.floor( parseInt(word) * (query.def.multiply || 1) / (query.def.divide || 1) ) ) );
		word = word.replace(/\-/, 'N');
		query.word = word;
		
		// syntax check
		var num = parseNumber(word);
		if (!num) {
			this.logError('index', "Invalid number format: " + word);
			return;
		}
		
		// check for simple equals
		if (query.operator == '=') {
			this._searchSingleWordIndex( query, record_id, idx_data, state );
			return;
		}
		
		// create "fake" summary index for record
		var summary = { id: def.id, values: {} };
		if (idx_data[def.id] && idx_data[def.id].word_hash) {
			summary.values = idx_data[def.id].word_hash;
		}
		
		var values = summary.values;
		var lesser = !!query.operator.match(/</);
		
		// operator includes exact match
		if (query.operator.match(/=/)) words.push( word );
		
		// add matching number tags based on operator
		for (var value in values) {
			var temp = parseNumber(value) || {};
			if (temp.exact) {
				// only compare if T and H match
				if (temp.hvalue == num.hvalue) {
					if (lesser) { if (temp.value < num.value) words.push(value); }
					else { if (temp.value > num.value) words.push(value); }
				}
			}
			else if (temp.hundreds) {
				if (lesser) { if (temp.hvalue < num.hvalue) words.push(value); }
				else { if (temp.hvalue > num.hvalue) words.push(value); }
			}
			else if (temp.thousands) {
				if (lesser) { if (temp.tvalue < num.tvalue) words.push(value); }
				else { if (temp.tvalue > num.tvalue) words.push(value); }
			}
		}
		
		// now perform OR search for all applicable words
		words.forEach( function(word) {
			// create "fake" hash index for word, containing only our one record
			var items = {};
			if (idx_data[def.id] && idx_data[def.id].word_hash && idx_data[def.id].word_hash[word]) {
				items[ record_id ] = idx_data[def.id].word_hash[word];
			}
			
			for (var key in items) temp_results[key] = 1;
		} );
		
		this.mergeIndex( record_ids, temp_results, state.first ? 'or' : state.mode );
		state.first = false;
	}
	
});
