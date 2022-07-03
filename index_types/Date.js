// PixlServer Storage System - Date Index Type Mixin
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

// A "Date" is a compound word index, where the YYYY, MM and DD values are 
// indexed as three separate words: YYYY_MM_DD, YYYY_MM, and YYYY.

// Date Ranges are queried by loading the summary (master_list) and OR'ing in 
// all records in relevant buckets.

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

// utility
var parseDate = function(str) {
	// parse YYYY_MM_DD, YYYY_MM or YYYY specifically
	var args = {};
	if (str.match(/^(\d{4})_(\d{2})_(\d{2})$/)) {
		args.yyyy = RegExp.$1; args.mm = RegExp.$2; args.dd = RegExp.$3;
		args.yyyy_mm = args.yyyy + '_' + args.mm;
	}
	else if (str.match(/^(\d{4})_(\d{2})$/)) { 
		args.yyyy = RegExp.$1; args.mm = RegExp.$2; 
		args.yyyy_mm = args.yyyy + '_' + args.mm;
	}
	else if (str.match(/^(\d{4})$/)) { 
		args.yyyy = RegExp.$1; 
	}
	else args = null;
	return args;
};

module.exports = Class.create({
	
	prepIndex_date: function(words, def, state) {
		// prep index write for date type
		// dates always require a master_list (summary)
		def.master_list = 1;
		
		// if (!words || !words.length) return false;
		var unique_words = {};
		var good = false;
		
		words.forEach( function(date) {
			if (date.match(/^(\d{4})_(\d{2})_(\d{2})$/)) {
				var yyyy = RegExp.$1;
				var mm = RegExp.$2;
				var dd = RegExp.$3;
				
				unique_words[ yyyy + '_' + mm + '_' + dd ] = 1;
				unique_words[ yyyy + '_' + mm ] = 1;
				unique_words[ yyyy ] = 1;
				good = true;
			}
		});
		
		return Tools.hashKeysToArray(unique_words);
	},
	
	prepDeleteIndex_date: function(words, def, state) {
		// prep for index delete (no return value)
		
		// dates require a master_list (summary)
		def.master_list = 1;
	},
	
	filterWords_date: function(orig_value) {
		// filter date queries
		return orig_value.trim().replace(/\,/g, ' ').split(/\s+/).map( function(value) {
			if (!value.match(/\S/)) return '';
			
			// MM/DD/YYYY --> YYYY_MM_DD
			// FUTURE: This is a very US-centric format assumption here
			if (value.match(/^(\d{2})\D+(\d{2})\D+(\d{4})$/)) {
				value = RegExp.$3 + '_' + RegExp.$1 + '_' + RegExp.$2;
			}
			
			// special search month/year formats
			else if (value.match(/^(\d{4})\D+(\d{2})$/)) { value = RegExp.$1 + '_' + RegExp.$2; }
			else if (value.match(/^(\d{4})$/)) { value = RegExp.$1; }
			
			// special search keywords
			else if (value.match(/^(today|now)$/i)) {
				var dargs = Tools.getDateArgs( Tools.timeNow(true) );
				value = dargs.yyyy_mm_dd;
			}
			else if (value.match(/^(yesterday)$/i)) {
				var midnight = Tools.normalizeTime( Tools.timeNow(true), { hour:0, min:0, sec:0 } );
				var yesterday_noonish = midnight - 43200;
				var dargs = Tools.getDateArgs( yesterday_noonish );
				value = dargs.yyyy_mm_dd;
			}
			else if (value.match(/^(this\s+month)$/i)) {
				var dargs = Tools.getDateArgs( Tools.timeNow(true) );
				value = dargs.yyyy + '_' + dargs.mm;
			}
			else if (value.match(/^(this\s+year)$/i)) {
				var dargs = Tools.getDateArgs( Tools.timeNow(true) );
				value = dargs.yyyy;
			}
			else if (value.match(/^\d+(\.\d+)?$/)) {
				// convert epoch date (local server timezone)
				var epoch = parseInt(value);
				if (!epoch) return '';
				var dargs = Tools.getDateArgs( epoch );
				value = dargs.yyyy_mm_dd;
			}
			else if (!value.match(/^(\d{4})\D+(\d{2})\D+(\d{2})$/)) {
				// try to convert using node date (local timezone)
				var dargs = Tools.getDateArgs( value + " 00:00:00" );
				value = dargs.epoch ? dargs.yyyy_mm_dd : '';
			}
			
			value = value.replace(/\D+/g, '_');
			return value;
		} ).join(' ').replace(/\s+/g, ' ').trim();
	},
	
	searchIndex_date: function(query, state, callback) {
		// search date index
		var self = this;
		var record_ids = state.record_ids;
		var word = query.word || query.words[0];
		var base_path = state.config.base_path + '/' + query.def.id;
		var sum_path = base_path + '/summary';
		var temp_results = {};
		var words = [];
		
		if (!query.operator) query.operator = '=';
		
		this.logDebug(10, "Running date query", query);
		
		word = word.replace(/\D+/g, '_');
		query.word = word;
		
		if (word.match(/^\d{5,}$/)) {
			// epoch date (local server timezone)
			var dargs = Tools.getDateArgs( parseInt(word) );
			word = dargs.yyyy + '_' + dargs.mm + '_' + dargs.dd;
			query.word = word;
		}
		
		// check for simple equals
		if (query.operator == '=') {
			return this.searchWordIndex(query, state, callback);
		}
		
		// adjust special month/date search tricks for first of month/year
		if (word.match(/^(\d{4})_(\d{2})$/)) word += "_01";
		else if (word.match(/^(\d{4})$/)) word += "_01_01";
		query.word = word;
		
		// syntax check
		var date = parseDate(word);
		if (!date) {
			return callback( new Error("Invalid date format: " + word) );
		}
		
		// load index summary for list of all populated dates
		var dspf = state.perf.begin('date_summary');
		this.get( sum_path, function(err, summary) {
			dspf.end();
			if (err || !summary) {
				summary = { id: query.def.id, values: {} };
			}
			var values = summary.values;
			var lesser = !!query.operator.match(/</);
			
			// operator includes exact match
			if (query.operator.match(/=/)) words.push( word );
			
			// add matching date tags based on operator
			for (var value in values) {
				var temp = parseDate(value) || {};
				if (temp.dd) {
					// only compare if yyyy and mm match
					if (temp.yyyy_mm == date.yyyy_mm) {
						if (lesser) { if (value < word) words.push(value); }
						else { if (value > word) words.push(value); }
					}
				}
				else if (temp.mm) {
					if (lesser) { if (temp.yyyy_mm < date.yyyy_mm) words.push(value); }
					else { if (temp.yyyy_mm > date.yyyy_mm) words.push(value); }
				}
				else if (temp.yyyy) {
					if (lesser) { if (temp.yyyy < date.yyyy) words.push(value); }
					else { if (temp.yyyy > date.yyyy) words.push(value); }
				}
			}
			
			// now perform OR search for all applicable words
			var drpf = state.perf.begin('date_range');
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
					drpf.end();
					state.perf.count('date_buckets', words.length);
					if (err) return callback(err);
					self.mergeIndex( record_ids, temp_results, state.first ? 'or' : state.mode );
					state.first = false;
					callback();
				}
			); // eachSeries
		} ); // get (summary)
	},
	
	searchSingle_date: function(query, record_id, idx_data, state) {
		// search date index vs single record (sync)
		var self = this;
		var record_ids = state.record_ids;
		var word = query.word || query.words[0];
		var def = query.def;
		var temp_results = {};
		var words = [];

		if (!query.operator) query.operator = '=';
		
		word = word.replace(/\D+/g, '_');
		query.word = word;
		
		if (word.match(/^\d{5,}$/)) {
			// epoch date (local server timezone)
			var dargs = Tools.getDateArgs( parseInt(word) );
			word = dargs.yyyy + '_' + dargs.mm + '_' + dargs.dd;
			query.word = word;
		}
		
		// check for simple equals
		if (query.operator == '=') {
			this._searchSingleWordIndex( query, record_id, idx_data, state );
			return;
		}
		
		// adjust special month/date search tricks for first of month/year
		if (word.match(/^(\d{4})_(\d{2})$/)) word += "_01";
		else if (word.match(/^(\d{4})$/)) word += "_01_01";
		query.word = word;
		
		// syntax check
		var date = parseDate(word);
		if (!date) {
			this.logError('index', "Invalid date format: " + word);
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
		
		// add matching date tags based on operator
		for (var value in values) {
			var temp = parseDate(value) || {};
			if (temp.dd) {
				// only compare if yyyy and mm match
				if (temp.yyyy_mm == date.yyyy_mm) {
					if (lesser) { if (value < word) words.push(value); }
					else { if (value > word) words.push(value); }
				}
			}
			else if (temp.mm) {
				if (lesser) { if (temp.yyyy_mm < date.yyyy_mm) words.push(value); }
				else { if (temp.yyyy_mm > date.yyyy_mm) words.push(value); }
			}
			else if (temp.yyyy) {
				if (lesser) { if (temp.yyyy < date.yyyy) words.push(value); }
				else { if (temp.yyyy > date.yyyy) words.push(value); }
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
