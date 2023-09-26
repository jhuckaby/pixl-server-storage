// PixlServer Storage System - Indexer Mixin
// Copyright (c) 2016 - 2020 Joseph Huckaby
// Released under the MIT License

var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");
var Perf = require("pixl-perf");
var nearley = require("nearley");
var pxql_grammar = require("./pxql.js");
var stemmer = require('porter-stemmer').stemmer;
var unidecode = require('unidecode');
var he = require('he');

var IndexerSingle = require("./indexer-single.js");
var DateIndexType = require("./index_types/Date.js");
var NumberIndexType = require("./index_types/Number.js");

module.exports = Class.create({
	
	__mixins: [ IndexerSingle, DateIndexType, NumberIndexType ],
	
	removeWordCache: null,
	
	indexRecord: function(id, record, config, callback) {
		// index record (transaction version)
		var self = this;
		
		// if no transactions, or transaction already in progress, jump to original func
		if (!this.transactions || this.currentTransactionPath) {
			return this._indexRecord(id, record, config, function(err, state) {
				if (err) self.logError('index', "Indexing failed on record: " + id + ": " + err);
				callback(err, state);
			});
		}
		
		// use base path for transaction lock
		var path = config.base_path;
		
		// here we go
		this.beginTransaction(path, function(err, clone) {
			// transaction has begun
			// call _indexRecord on CLONE (transaction-aware storage instance)
			clone._indexRecord(id, record, config, function(err, state) {
				if (err) {
					// index generated an error
					self.logError('index', "Indexing failed on record: " + id + ": " + err);
					
					// emergency abort, rollback
					self.abortTransaction(path, function() {
						// call original callback with error that triggered rollback
						if (callback) callback( err );
					}); // abort
				}
				else {
					// no error, commit transaction
					self.commitTransaction(path, function(err) {
						if (err) {
							// commit failed, trigger automatic rollback
							self.abortTransaction(path, function() {
								// call original callback with commit error
								if (callback) callback( err );
							}); // abort
						} // commit error
						else {
							// success!  call original callback
							if (callback) callback(null, state);
						}
					}); // commit
				} // no error
			}); // _indexRecord
		}); // beginTransaction
	},
	
	validateIndexConfig: function(config) {
		// make sure index config is kosher
		// return false for success, or error on failure
		if (!config || !config.fields || !Tools.isaArray(config.fields)) {
			return( new Error("Invalid index configuration object.") );
		}
		if (Tools.findObject(config.fields, { _primary: 1 })) {
			return( new Error("Invalid index configuration key: _primary") );
		}
		
		// validate each field def
		for (var idx = 0, len = config.fields.length; idx < len; idx++) {
			var def = config.fields[idx];
			
			if (!def.id || !def.id.match(/^\w+$/)) {
				return( new Error("Invalid index field ID: " + def.id) );
			}
			if (def.id.match(/^(_id|_data|_sorters|constructor|__defineGetter__|__defineSetter__|hasOwnProperty|__lookupGetter__|__lookupSetter__|isPrototypeOf|propertyIsEnumerable|toString|valueOf|__proto__|toLocaleString)$/)) {
				return( new Error("Invalid index field ID: " + def.id) );
			}
			
			if (def.type && !this['prepIndex_' + def.type]) {
				return( new Error("Invalid index type: " + def.type) );
			}
			
			if (def.filter && !this['filterWords_' + def.filter]) {
				return( new Error("Invalid index filter: " + def.filter) );
			}
		} // foreach def
		
		// validate each sorter def
		if (config.sorters) {
			if (!Tools.isaArray(config.sorters)) {
				return( new Error("Invalid index sorters array.") );
			}
			
			for (var idx = 0, len = config.sorters.length; idx < len; idx++) {
				var sorter = config.sorters[idx];
				
				if (!sorter.id || !sorter.id.match(/^\w+$/)) {
					return( new Error("Invalid index sorter ID: " + sorter.id) );
				}
				if (sorter.id.match(/^(_id|_data|_sorters|constructor|__defineGetter__|__defineSetter__|hasOwnProperty|__lookupGetter__|__lookupSetter__|isPrototypeOf|propertyIsEnumerable|toString|valueOf|__proto__|toLocaleString)$/)) {
					return( new Error("Invalid index sorter ID: " + sorter.id) );
				}
				if (sorter.type && !sorter.type.match(/^(string|number)$/)) {
					return( new Error("Invalid index sorter type: " + sorter.type) );
				}
			} // foreach sorter
		} // config.sorters
		
		return false; // no error
	},
	
	_indexRecord: function(id, record, config, callback) {
		// index record (internal)
		var self = this;
		this.logDebug(8, "Indexing record: " + id, record);
		
		var state = {
			id: id,
			config: config
		};
		
		// sanity checks
		if (!id) {
			if (callback) callback( new Error("Missing Record ID for indexing.") );
			return;
		}
		
		// make sure ID is a string, and has some alphanumeric portion
		id = '' + id;
		var normal_id = this.normalizeKey(id);
		if (!normal_id || !normal_id.match(/^\w/)) {
			if (callback) callback( new Error("Invalid Record ID for indexing: " + id) );
			return;
		}
		
		if (!record || !Tools.isaHash(record)) {
			if (callback) callback( new Error("Invalid record object for index.") );
			return;
		}
		
		// make sure we have a good config
		var err = this.validateIndexConfig(config);
		if (err) {
			if (callback) callback(err);
			return;
		}
		
		// generate list of fields based on available values in record
		// i.e. support partial updates by only passing in those fields
		var fields = [];
		
		config.fields.forEach( function(def) {
			var value = def.source.match(/\[.+\]/) ? Tools.sub(def.source, record, true) : Tools.getPath(record, def.source);
			if (value === undefined) value = null;
			if ((value === null) && ("default_value" in def)) value = def.default_value;
			if (value !== null) fields.push(def);
		} );
		
		// start index and track perf
		var pf = this.perf.begin('index');
		
		// lock record (non-existent key, but it's record specific for the lock)
		this.lock( config.base_path + '/' + id, true, function() {
			
			// see if we've already indexed this record before
			self.get( config.base_path + '/_data/' + id, function(err, idx_data) {
				// check for fatal I/O error
				if (err && (err.code != 'NoSuchKey')) {
					self.unlock( config.base_path + '/' + id );
					pf.end();
					return callback(err);
				}
				
				if (!idx_data) {
					idx_data = {};
					state.new_record = true;
					
					// add special index for primary ID (just a hash -- new records only)
					fields.push({ _primary: 1 });
				}
				state.idx_data = idx_data;
				state.changed = {};
				
				// walk all fields in parallel (everything gets enqueued anyway)
				async.each( fields,
					function(def, callback) {
						// process each index
						if (def._primary) {
							// primary id hash
							var opts = { page_size: config.hash_page_size || 1000 };
							self.hashPut( config.base_path + '/_id', id, 1, opts, callback );
							return;
						}
						
						var value = def.source.match(/\[.+\]/) ? Tools.sub(def.source, record, true) : Tools.getPath(record, def.source);
						if (value === undefined) value = null;
						if ((value === null) && ("default_value" in def)) value = def.default_value;
						if (typeof(value) == 'object') value = JSON.stringify(value);
						
						var words = self.getWordList( ''+value, def, config );
						var checksum = Tools.digestHex( words.join(' '), 'md5' );
						var data = { words: words, checksum: checksum };
						var old_data = idx_data[ def.id ];
						
						self.logDebug(9, "Preparing data for index: " + def.id, {
							value: value,
							words: words,
							checksum: checksum
						});
						
						if (def.delete) {
							// special mode: delete index data
							if (old_data) {
								state.changed[ def.id ] = 1;
								self.deleteIndex( old_data, def, state, callback );
							}
							else callback();
						}
						else if (old_data) {
							// index exists, check if data has changed
							if (checksum != old_data.checksum) {
								// must reindex
								state.changed[ def.id ] = 1;
								self.updateIndex( old_data, data, ''+value, def, state, callback );
							}
							else {
								// data not changed, no action required
								self.logDebug(9, "Index value unchanged, skipping: " + def.id);
								callback();
							}
						}
						else {
							// index doesn't exist for this record, create immediately
							state.changed[ def.id ] = 1;
							self.writeIndex( data, ''+value, def, state, callback );
						}
					}, // iterator
					function(err) {
						// everything indexed
						if (err) {
							self.unlock( config.base_path + '/' + id );
							pf.end();
							if (callback) callback(err);
							return;
						}
						
						// now handle the sorters
						async.eachLimit( config.sorters || [], self.concurrency,
							function(sorter, callback) {
								if (sorter.delete) self.deleteSorter( id, sorter, state, callback );
								else self.updateSorter( record, sorter, state, callback );
							},
							function(err) {
								// all sorters sorted
								// save idx data for record
								self.put( config.base_path + '/_data/' + id, idx_data, function(err) {
									if (err) {
										self.unlock( config.base_path + '/' + id );
										pf.end();
										if (callback) callback(err);
										return;
									}
									
									var elapsed = pf.end();
									
									if (!err) self.logTransaction('index', config.base_path, {
										id: id,
										elapsed_ms: elapsed
									});
									
									self.unlock( config.base_path + '/' + id );
									if (callback) callback(err, state);
								} ); // put (_data)
							}
						); // eachLimit (sorters)
					} // done with fields
				); // each (fields)
			} ); // get (_data)
		} ); // lock
	},
	
	unindexRecord: function(id, config, callback) {
		// unindex record (transaction version)
		var self = this;
		
		// if no transactions, or transaction already in progress, jump to original func
		if (!this.transactions || this.currentTransactionPath) {
			return this._unindexRecord(id, config, callback);
		}
		
		// use base path for transaction lock
		var path = config.base_path;
		
		// here we go
		this.beginTransaction(path, function(err, clone) {
			// transaction has begun
			// call _unindexRecord on CLONE (transaction-aware storage instance)
			clone._unindexRecord(id, config, function(err, state) {
				if (err) {
					// index generated an error
					// emergency abort, rollback
					self.abortTransaction(path, function() {
						// call original callback with error that triggered rollback
						if (callback) callback( err );
					}); // abort
				}
				else {
					// no error, commit transaction
					self.commitTransaction(path, function(err) {
						if (err) {
							// commit failed, trigger automatic rollback
							self.abortTransaction(path, function() {
								// call original callback with commit error
								if (callback) callback( err );
							}); // abort
						} // commit error
						else {
							// success!  call original callback
							if (callback) callback(null, state);
						}
					}); // commit
				} // no error
			}); // _unindexRecord
		}); // beginTransaction
	},
	
	_unindexRecord: function(id, config, callback) {
		// unindex record (internal)
		var self = this;
		this.logDebug(8, "Unindexing record: " + id);
		
		var state = {
			id: id,
			config: config
		};
		
		// sanity checks
		if (!id) {
			if (callback) callback( new Error("Invalid ID for record index.") );
			return;
		}
		
		// make sure we have a good config
		var err = this.validateIndexConfig(config);
		if (err) {
			if (callback) callback(err);
			return;
		}
		
		// copy fields so we can add the special primary one
		var fields = [];
		for (var idx = 0, len = config.fields.length; idx < len; idx++) {
			fields.push( config.fields[idx] );
		}
		
		// add special index for primary ID (just a hash)
		fields.push({ _primary: 1 });
		
		// start unindex and track perf
		var pf = this.perf.begin('unindex');
		
		// lock record (non-existent key, but it's record specific for the lock)
		this.lock( config.base_path + '/' + id, true, function() {
			
			// see if we've indexed this record before
			self.get( config.base_path + '/_data/' + id, function(err, idx_data) {
				// check for error
				if (err) {
					self.unlock( config.base_path + '/' + id );
					pf.end();
					return callback(err);
				}
				
				state.idx_data = idx_data;
				state.changed = {};
				
				// walk all fields in parallel (everything gets enqueued anyway)
				async.each( fields,
					function(def, callback) {
						// primary id hash
						if (def._primary) {
							self.hashDelete( config.base_path + '/_id', id, callback );
							return;
						}
						
						// check if index exists
						var data = idx_data[ def.id ];
						
						if (data) {
							// index exists, proceed with delete
							state.changed[ def.id ] = 1;
							self.deleteIndex( data, def, state, callback );
						}
						else callback();
					},
					function(err) {
						// everything unindexed
						if (err) {
							self.unlock( config.base_path + '/' + id );
							pf.end();
							if (callback) callback(err);
							return;
						}
						
						// delete main idx data record
						self.delete( config.base_path + '/_data/' + id, function(err) {
							if (err) {
								self.unlock( config.base_path + '/' + id );
								pf.end();
								if (callback) callback(err);
								return;
							}
							
							// now handle the sorters
							async.eachLimit( config.sorters || [], self.concurrency,
								function(sorter, callback) {
									self.deleteSorter( id, sorter, state, callback );
								},
								function(err) {
									// all sorters sorted
									var elapsed = pf.end();
									
									if (!err) self.logTransaction('unindex', config.base_path, {
										id: id,
										elapsed_ms: elapsed
									});
									
									self.unlock( config.base_path + '/' + id );
									if (callback) callback(err, state);
								}
							); // eachLimit (sorters)
						} ); // delete (_data)
					} // done (fields)
				); // each (fields)
			} ); // get (_data)
		} ); // lock
	},
	
	writeIndex: function(data, raw_value, def, state, callback) {
		// create or update single field index
		var self = this;
		var words = data.words;
		
		// check for custom index prep function
		if (def.type) {
			var func = 'prepIndex_' + def.type;
			if (self[func]) {
				var result = self[func]( words, def, state );
				if (result === false) {
					if (callback) {
						callback( new Error("Invalid data for index: " + def.id + ": " + words.join(' ')) );
					}
					return;
				}
				data.words = words = result;
			}
		}
		
		this.logDebug(9, "Indexing field: " + def.id + " for record: " + state.id, words);
		
		var base_path = state.config.base_path + '/' + def.id;
		var word_hash = this.getWordHashFromList( words );
		
		// first, save idx record (word list and checksum)
		state.idx_data[ def.id ] = data;
		
		// word list may be empty
		if (!words.length && !def.master_list) {
			self.logDebug(9, "Word list is empty, skipping " + def.id + " for record: " + state.id);
			if (callback) callback();
			return;
		}
		
		// now index each unique word
		var group = {
			count: Tools.numKeys(word_hash),
			callback: callback || null
		};
		
		// lock index for this
		self.lock( base_path, true, function() {
			// update master list if applicable
			if (def.master_list) {
				group.count++;
				self.indexEnqueue({
					action: 'custom', 
					label: 'writeIndexSummary',
					handler: self.writeIndexSummary.bind(self),
					def: def,
					group: group,
					base_path: base_path,
					word_hash: word_hash,
					raw_value: raw_value
				});
			} // master_list
			
			for (var word in word_hash) {
				var value = word_hash[word];
				var path = base_path + '/word/' + word;
				
				self.indexEnqueue({
					action: 'custom', 
					label: 'writeIndexWord',
					handler: self.writeIndexWord.bind(self),
					hash_page_size: state.config.hash_page_size || 1000,
					// config: state.config,
					group: group,
					word: word,
					id: state.id,
					base_path: base_path,
					path: path,
					value: value
				});
			} // foreach word
			
		} ); // lock
	},
	
	writeIndexWord: function(task, callback) {
		// index single word, invoked from storage queue
		var self = this;
		var opts = { page_size: task.hash_page_size || 1000, word: task.word };
		
		this.logDebug(10, "Indexing word: " + task.path + " for record: " + task.id);
		
		this.hashPut( task.path, task.id, task.value, opts, function(err) {
			if (err) {
				// this will bubble up at the end of the group
				task.group.error = "Failed to write index data: " + task.path + ": " + err.message;
				self.logError('index', task.group.error);
			}
			
			// check to see if we are the last task in the group
			task.group.count--;
			if (!task.group.count) {
				// group is complete, unlock and fire secondary callback if applicable
				self.unlock(task.base_path);
				if (task.group.callback) task.group.callback(task.group.error);
			} // last item in group
			
			// queue callback
			callback();
		} ); // hashPut
	},
	
	writeIndexSummary: function(task, callback) {
		// index summary of words (record counts per word), invoked from storage queue
		var self = this;
		this.logDebug(10, "Updating summary index: " + task.base_path);
		
		var path = task.base_path + '/summary';
		var word_hash = task.word_hash;
		
		this.lock( path, true, function() {
			// locked
			self.get( path, function(err, summary) {
				if (err && (err.code != 'NoSuchKey')) {
					// serious I/O error, need to bubble this up
					task.group.error = "Failed to get index summary data: " + path + ": " + err.message;
					self.logError('index', task.group.error);
				}
				if (err || !summary) {
					summary = { id: task.def.id, values: {} };
				}
				summary.values = Tools.copyHashRemoveProto( summary.values );
				summary.modified = Tools.timeNow(true);
				
				for (var word in word_hash) {
					if (!summary.values[word]) summary.values[word] = 0;
					summary.values[word]++;
					
					if (task.def.master_labels) {
						if (!summary.labels) summary.labels = {};
						summary.labels[word] = task.raw_value;
					}
				} // foreach word
				
				// save summary back to storage
				self.put( path, summary, function(err) {
					self.unlock( path );
					if (err) {
						// this will bubble up at the end of the group
						task.group.error = "Failed to write index summary data: " + path + ": " + err.message;
						self.logError('index', task.group.error);
					}
					
					// check to see if we are the last task in the group
					task.group.count--;
					if (!task.group.count) {
						// group is complete, unlock and fire secondary callback if applicable
						self.unlock(task.base_path);
						if (task.group.callback) task.group.callback(task.group.error);
					} // last item in group
					
					// queue callback
					callback();
					
				} ); // put
			} ); // get
		} ); // lock
	},
	
	deleteIndex: function(data, def, state, callback) {
		// delete index
		// this must be sequenced before a reindex
		var self = this;
		var words = data.words;
		
		// check for custom index prep delete function
		if (def.type) {
			var func = 'prepDeleteIndex_' + def.type;
			if (self[func]) {
				self[func]( words, def, state );
			}
		}
		
		this.logDebug(9, "Unindexing field: " + def.id + " for record: " + state.id, words);
		
		var base_path = state.config.base_path + '/' + def.id;
		var word_hash = this.getWordHashFromList( words );
		
		// first, delete idx record (word list and checksum)
		delete state.idx_data[ def.id ];
		
		// word list may be empty
		if (!words.length && !def.master_list) {
			self.logDebug(9, "Word list is empty, skipping " + def.id + " for record: " + state.id);
			if (callback) callback();
			return;
		}
		
		// now unindex each unique word
		var group = {
			count: Tools.numKeys(word_hash),
			callback: callback || null
		};
		
		// lock index for this
		self.lock( base_path, true, function() {
			// update master list if applicable
			if (def.master_list) {
				group.count++;
				self.indexEnqueue({
					action: 'custom', 
					label: 'deleteIndexSummary',
					handler: self.deleteIndexSummary.bind(self),
					def: def,
					group: group,
					base_path: base_path,
					word_hash: word_hash
				});
			} // master_list
			
			for (var word in word_hash) {
				var path = base_path + '/word/' + word;
				
				self.indexEnqueue({
					action: 'custom', 
					label: 'deleteIndexWord',
					handler: self.deleteIndexWord.bind(self),
					group: group,
					word: word,
					id: state.id,
					base_path: base_path,
					path: path
				});
			} // foreach word
			
		} ); // lock
	},
	
	deleteIndexWord: function(task, callback) {
		// delete single word, invoked from storage queue
		var self = this;
		this.logDebug(10, "Unindexing word: " + task.path + " for record: " + task.id);
		
		this.hashDelete( task.path, task.id, true, function(err) {
			if (err) {
				var err_msg = "Failed to write index data: " + task.path + ": " + err.message;
				self.logError('index', err_msg);
				
				// check for fatal I/O
				if (err.code != 'NoSuchKey') {
					// this will bubble up at end
					task.group.error = err_msg;
				}
			}
			
			// check to see if we are the last task in the group
			task.group.count--;
			if (!task.group.count) {
				// group is complete, unlock and fire secondary callback if applicable
				self.unlock(task.base_path);
				if (task.group.callback) task.group.callback(task.group.error);
			} // last item in group
			
			// queue callback
			callback();
		} ); // hashDelete
	},
	
	deleteIndexSummary: function(task, callback) {
		// delete summary of words (record counts per word), invoked from storage queue
		var self = this;
		this.logDebug(10, "Removing words from summary index: " + task.base_path, task.word_hash);
		
		var path = task.base_path + '/summary';
		var word_hash = task.word_hash;
		
		this.lock( path, true, function() {
			// locked
			self.get( path, function(err, summary) {
				if (err && (err.code != 'NoSuchKey')) {
					// serious I/O error, need to bubble this up
					task.group.error = "Failed to get index summary data: " + path + ": " + err.message;
					self.logError('index', task.group.error);
				}
				if (err || !summary) {
					// index summary doesn't exist, huh
					self.logDebug(5, "Index summary doesn't exist: " + path);
					summary = { id: task.def.id, values: {} };
				}
				summary.values = Tools.copyHashRemoveProto( summary.values );
				summary.modified = Tools.timeNow(true);
				
				for (var word in word_hash) {
					if (summary.values[word]) summary.values[word]--;
					if (!summary.values[word]) {
						delete summary.values[word];
						if (task.def.master_labels && summary.labels) delete summary.labels[word];
					}
				} // foreach word
				
				// save summary back to storage
				self.put( path, summary, function(err) {
					self.unlock( path );
					if (err) {
						// this will bubble up at the end of the group
						task.group.error = "Failed to write index summary data: " + path + ": " + err.message;
						self.logError('index', task.group.error);
					}
					
					// check to see if we are the last task in the group
					task.group.count--;
					if (!task.group.count) {
						// group is complete, unlock and fire secondary callback if applicable
						self.unlock(task.base_path);
						if (task.group.callback) task.group.callback(task.group.error);
					} // last item in group
					
					// queue callback
					callback();
					
				} ); // put
			} ); // get
		} ); // lock
	},
	
	updateIndex: function(old_data, new_data, raw_value, def, state, callback) {
		// efficiently update single field index
		var self = this;
		var old_words = old_data.words;
		var new_words = new_data.words;
		
		// check for custom index prep function
		// we only need this on the new words
		if (def.type) {
			var func = 'prepIndex_' + def.type;
			if (self[func]) {
				var result = self[func]( new_words, def, state );
				if (result === false) {
					if (callback) {
						callback( new Error("Invalid data for index: " + def.id + ": " + new_words.join(' ')) );
					}
					return;
				}
				new_data.words = new_words = result;
			}
		}
		
		this.logDebug(9, "Updating Index: " + def.id + " for record: " + state.id, new_words);
		
		var base_path = state.config.base_path + '/' + def.id;
		var old_word_hash = this.getWordHashFromList( old_words );
		var new_word_hash = this.getWordHashFromList( new_words );
		
		// calculate added, changed and removed words
		var added_words = Object.create(null);
		var changed_words = Object.create(null);
		var removed_words = Object.create(null);
		
		for (var new_word in new_word_hash) {
			var new_value = new_word_hash[new_word];
			if (!(new_word in old_word_hash)) {
				// added new word
				added_words[new_word] = new_value;
			}
			if (new_value != old_word_hash[new_word]) {
				// also includes added, which is fine
				changed_words[new_word] = new_value;
			}
		}
		for (var old_word in old_word_hash) {
			if (!(old_word in new_word_hash)) {
				// word removed
				removed_words[old_word] = 1;
			}
		}
		
		// write idx record (word list and checksum)
		state.idx_data[ def.id ] = new_data;
		
		// now index each unique word
		var group = {
			count: Tools.numKeys(changed_words) + Tools.numKeys(removed_words),
			callback: callback || null
		};
		
		if (!group.count) {
			this.logDebug(9, "Actually, nothing changed in index: " + def.id + " for record: " + state.id + ", skipping updateIndex");
			if (callback) callback();
			return;
		}
		
		// lock index for this
		self.lock( base_path, true, function() {
			// update master list if applicable
			if (def.master_list) {
				if (Tools.numKeys(added_words) > 0) {
					group.count++;
					self.indexEnqueue({
						action: 'custom', 
						label: 'writeIndexSummary',
						handler: self.writeIndexSummary.bind(self),
						def: def,
						group: group,
						base_path: base_path,
						word_hash: added_words,
						raw_value: raw_value
					});
				}
				if (Tools.numKeys(removed_words) > 0) {
					group.count++;
					self.indexEnqueue({
						action: 'custom', 
						label: 'deleteIndexSummary',
						handler: self.deleteIndexSummary.bind(self),
						def: def,
						group: group,
						base_path: base_path,
						word_hash: removed_words
					});
				}
			} // master_list
			
			for (var word in changed_words) {
				var value = changed_words[word];
				var path = base_path + '/word/' + word;
				
				self.indexEnqueue({
					action: 'custom', 
					label: 'writeIndexWord',
					handler: self.writeIndexWord.bind(self),
					hash_page_size: state.config.hash_page_size || 1000,
					// config: state.config,
					group: group,
					word: word,
					id: state.id,
					base_path: base_path,
					path: path,
					value: value
				});
			} // foreach changed word
			
			for (var word in removed_words) {
				var path = base_path + '/word/' + word;
				
				self.indexEnqueue({
					action: 'custom', 
					label: 'deleteIndexWord',
					handler: self.deleteIndexWord.bind(self),
					group: group,
					word: word,
					id: state.id,
					base_path: base_path,
					path: path
				});
			} // foreach removed word
			
		} ); // lock
	},
	
	indexEnqueue: function(task) {
		// special index version of enqueue()
		// if we're in a transaction, call ORIGINAL enqueue() from parent
		// this is because index queue items must execute right away -- they CANNOT wait until commit()
		if (this.rawStorage) this.rawStorage.enqueue(task);
		else this.enqueue(task);
	},
	
	updateSorter: function(record, sorter, state, callback) {
		// add record to sorter index
		var config = state.config;
		
		var value = Tools.getPath(record, sorter.source);
		if (value === undefined) value = null;
		if ((value === null) && ("default_value" in sorter)) value = sorter.default_value;
		if (value === null) {
			if (state.new_record) value = ((sorter.type == 'number') ? 0 : '');
			else return callback();
		}
		
		// store value in idx_data as well
		if (!state.idx_data._sorters) state.idx_data._sorters = {};
		else if ((sorter.id in state.idx_data._sorters) && (value == state.idx_data._sorters[sorter.id])) {
			// sorter value unchanged, return immediately
			this.logDebug(10, "Sorter value unchanged, skipping write: " + sorter.id + ": " + state.id + ": " + value);
			return callback();
		}
		
		state.idx_data._sorters[sorter.id] = value;
		
		var path = config.base_path + '/' + sorter.id + '/sort';
		var opts = { page_size: config.sorter_page_size || 1000 };
		
		this.logDebug(10, "Setting value in sorter: " + sorter.id + ": " + state.id + ": " + value);
		this.hashPut( path, state.id, value, opts, callback );
	},
	
	deleteSorter: function(id, sorter, state, callback) {
		// remove record from sorter index
		var config = state.config;
		var path = config.base_path + '/' + sorter.id + '/sort';
		
		this.logDebug(10, "Removing record from sorter: " + sorter.id + ": " + id);
		this.hashDelete( path, id, function(err) {
			// only report actual I/O errors
			if (err && (err.code != 'NoSuchKey')) {
				return callback(err);
			}
			callback();
		} );
	},
	
	filterWords_markdown: function(value) {
		// filter out markdown syntax and html tags, entities
		value = value.replace(/\n\`\`\`(.+?)\`\`\`/g, ''); // fenced code
		return this.filterWords_html(value);
	},
	
	filterWords_html: function(value) {
		// filter out html tags, entities
		return he.decode( value.replace(/<.+?>/g, '') );
	},
	
	filterWords_alphanum: function(value) {
		// filter out everything except alphanum + underscore
		return value.replace(/\W+/g, '_').replace(/_+/g, '_');
	},
	
	filterWords_alphanum_array: function(value) {
		// filter out everything except alphanum + underscore + comma, suitable for JSON arrays
		return value.replace(/[\[\]\"\']+/g, '').replace(/[^\w\,]+/g, '_').replace(/_+/g, '_');
	},
	
	getWordList: function(value, def, config) {
		// clean and filter text down to list of alphanumeric words
		// return array of clean words
		if (def.filter && this['filterWords_' + def.filter]) {
			value = this['filterWords_' + def.filter]( value );
		}
		if (def.type && this['filterWords_' + def.type]) {
			value = this['filterWords_' + def.type]( value );
		}
		
		// more text cleanup
		if (!def.no_cleanup) {
			value = unidecode( value ); // convert unicode to ascii
			value = value.replace(/\w+\:\/\/([\w\-\.]+)\S*/g, '$1'); // index domains, not full urls
			value = value.replace(/\'/g, ''); // index nancy's as nancys
			value = value.replace(/\d+\.\d[\d\.]*/g, function(m) { return m.replace(/\./g, '_').replace(/_+$/, ''); }); // 2.5 --> 2_5
		}
		
		// special filter for firstname.lastname usernames
		if (def.username_join) {
			value = value.replace(/\w+\.\w[\w\.]*/g, function(m) { return m.replace(/\./g, '_').replace(/_+$/, ''); });
		}
		
		value = value.toLowerCase();
		
		var min_len = def.min_word_length || 1;
		var max_len = def.max_word_length || 255;
		var items = value.split(/\b/);
		var words = [];
		
		var remove_words = Object.create(null);
		if (def.use_remove_words && config.remove_words) {
			remove_words = this.cacheRemoveWords(config);
		}
		
		for (var idx = 0, len = items.length; idx < len; idx++) {
			var word = items[idx];
			if (word.match(/^\w+$/) && (word.length >= min_len) && (word.length <= max_len) && !remove_words[word]) {
				if (def.use_stemmer) word = stemmer(word);
				words.push( word );
			}
		}
		
		if (def.max_words && (words.length > def.max_words)) {
			words.splice( def.max_words );
		}
		
		return words;
	},
	
	getWordHashFromList: function(words) {
		// convert word list to hash of unique words and offset CSV
		var hash = Object.create(null);
		var word = '';
		
		for (var idx = 0, len = words.length; idx < len; idx++) {
			word = words[idx];
			if (word in hash) hash[word] += ','; else hash[word] = '';
			hash[word] += '' + Math.floor(idx + 1);
		} // foreach word
		
		return hash;
	},
	
	parseSearchQuery: function(value, config) {
		// parse search query string into array of criteria
		var criteria = [];
		var cur_index = config.default_search_field || '';
		
		this.logDebug(9, "Parsing simple search query: " + value);
		
		// basic pre-cleanup
		value = value.replace(/\s*\:\s*/g, ':');
		value = value.replace(/\s*\|\s*/g, '|');
		
		// escape literals (they will be re-unescaped below after splitting)
		value = value.replace(/\"(.+?)\"/g, function(m_all, m_g1) { return '"' + escape(m_g1) + '"'; } );
		
		var parts = value.split(/\s+/);
		
		for (var idx = 0, len = parts.length; idx < len; idx++) {
			var part = parts[idx];
			var crit = {};
			if (part.match(/^(\w+)\:(.+)$/)) {
				cur_index = RegExp.$1;
				part = RegExp.$2;
			}
			var def = Tools.findObject( config.fields, { id: cur_index || '_NOPE_' } );
			if (def) {
				if (part.match(/\|/)) {
					// piped OR list of values, must create sub-query
					crit.mode = 'or';
					crit.criteria = [];
					
					var pipes = part.split(/\|/);
					for (var idy = 0, ley = pipes.length; idy < ley; idy++) {
						var pipe = pipes[idy];
						
						var sub_words = this.getWordList(pipe, def, config);
						for (var idz = 0, lez = sub_words.length; idz < lez; idz++) {
							crit.criteria.push({ index: cur_index, word: sub_words[idz] });
						}
					}
					
					if (crit.criteria.length) criteria.push( crit );
				}
				else {
					crit.index = cur_index;
					
					part = part.replace(/^\+/, '');
					if (part.match(/^\-/)) {
						crit.negative = 1;
						part = part.replace(/^\-/, '');
					}
					if (part.match(/^\"(.+)\"$/)) {
						crit.literal = 1;
						part = unescape( RegExp.$1 );
						crit.words = this.getWordList(part, def, config);
					}
					else if (def.type) {
						// all defs with a 'type' are assumed to support ranges and lt/gt
						if (part.match(/^(.+)\.\.(.+)$/)) {
							// range between two values (inclusive)
							var low = RegExp.$1;
							var high = RegExp.$2;
							crit = {
								mode: 'and', 
								criteria: [
									{ index: cur_index, operator: ">=", word: low },
									{ index: cur_index, operator: "<=", word: high }
								]
							};
							criteria.push( crit );
						}
						else {
							// exact match or open-ended range
							var op = '=';
							if (part.match(/^(=|>=|>|<=|<)(.+)$/)) {
								op = RegExp.$1;
								part = RegExp.$2;
							}
							crit.operator = op;
							// crit.word = part;
							var words = this.getWordList(part, def, config);
							if (words.length) crit.word = words[0];
						}
					}
					else {
						var words = this.getWordList(part, def, config);
						if (words.length > 1) {
							crit.literal = 1;
							crit.words = words;
						}
						else if (words.length) crit.word = words[0];
					}
					
					if (crit.word || (crit.words && crit.words.length)) criteria.push( crit );
				}
			} // cur_index
		} // foreach part
		
		var query = { mode: 'and', criteria: criteria };
		
		this.logDebug(10, "Compiled search query:", query);
		return query;
	},
	
	parseGrammar: function(value, config) {
		// parse PxQL syntax, convert to native format
		var self = this;
		var parser = new nearley.Parser( nearley.Grammar.fromCompiled(pxql_grammar) );
		
		// pre-cleanup, normalize whitespace
		value = value.replace(/\s+/g, " ");
		
		this.logDebug(9, "Parsing PxQL search query: " + value);
		
		try {
			parser.feed( value );
		}
		catch (err) {
			return { err: err };
		}
		
		var query = parser.results[0];
		if (!query) {
			return { err: new Error("Failed to parse") };
		}
		if (!query.criteria && query.index) {
			// single criteria collapsed into parent
			query = { mode: 'and', criteria: [ query ] };
		}
		if (!query.criteria || !query.criteria.length) {
			return { err: new Error("Failed to parse") };
		}
		delete query.err;
		
		// apply post-processing for exact phrases, remove words
		var processCriteria = function(criteria) {
			// walk array, recurse for inner sub-queries
			criteria.forEach( function(crit) {
				if (query.err) return;
				
				if (crit.word) {
					// standard word query
					var def = Tools.findObject( config.fields, { id: crit.index || '_NOPE_' } );
					if (def) {
						var words = self.getWordList(crit.word, def, config);
						if (words.length > 1) {
							// literal multi-word phrase
							crit.words = words;
							crit.literal = 1;
							delete crit.word;
						}
						else if (words.length == 1) {
							// single word match
							crit.word = words[0];
						}
						else {
							// all words were removed
							// not technically an error, but this clause needs to be skipped
							self.logDebug(9, "All words removed from criteron: " + crit.word, crit);
							crit.skip = 1;
						}
					}
					else {
						query.err = new Error("Index not found: " + crit.index);
						return;
					}
				}
				if (crit.criteria && !query.err) processCriteria( crit.criteria );
			} );
		};
		
		processCriteria( query.criteria );
		return query;
	},
	
	weighCriterion: function(crit, config, callback) {
		// weigh single criterion for estimated memory usage
		var base_path = config.base_path + '/' + crit.index;
		var word = crit.word || crit.words[0];
		var path = base_path + '/word/' + word;
		
		// this doesn't work on ranged queries with typed columns, e.g. dates and numbers
		// as those use a master index for searching
		var def = Tools.findObject( config.fields, { id: crit.index } );
		if (def && def.type && crit.operator && crit.operator.match(/<|>/)) {
			crit.weight = 0;
			process.nextTick( function() { callback(); } );
			return;
		}
		
		this.hashGetInfo(path, function(err, hash) {
			if (hash && hash.length) crit.weight = hash.length;
			else crit.weight = 0;
			callback();
		});
	},
	
	searchRecords: function(query, config, callback) {
		// search fields (public API with shared lock on trans commit key)
		// this will block only if a transaction is currently committing
		var self = this;
		var path = config.base_path;
		var pf = this.perf.begin('search');
		
		var orig_query = query;
		if (typeof(query) == 'object') query = Tools.copyHash(query, true);
		
		this.shareLock( 'C|'+path, true, function(err, lock) {
			// got shared lock
			self._searchRecords( query, config, function(err, results, state) {
				// search complete
				if (!err) self.logTransaction('search', path, {
					query: orig_query,
					perf: state.perf ? state.perf.metrics() : {},
					results: (self.logEventTypes.search || self.logEventTypes.all) ? Tools.numKeys(results) : 0
				});
				
				self.shareUnlock( 'C|'+path );
				callback( err, results, state );
			} ); // search
		} ); // lock
	},
	
	_searchRecords: function(query, config, callback) {
		// search index for criteria, e.g. status:bug|enhancement assigned:jhuckaby created:2016-05-08
		// or main_text:google +style "query here" -yay status:open
		// return hash of matching record ids
		var self = this;
		
		// parse search string if required
		if (typeof(query) == 'string') {
			query = query.trim();
			
			if (query == '*') {
				// fetch all records
				this.logDebug(8, "Fetching all records: " + config.base_path);
				var apf = new Perf();
				apf.begin();
				apf.begin('all');
				
				return this.hashGetAll( config.base_path + '/_id', function(err, results) {
					// ignore error, just return empty hash
					apf.end('all');
					apf.end();
					callback( null, results || {}, { perf: apf } );
				} );
			}
			else if (query.match(/^\([\s\S]+\)$/)) {
				// PxQL syntax, parse grammar
				query = this.parseGrammar(query, config);
				if (query.err) {
					this.logError('index', "Invalid search query: " + query.err, query);
					return callback(query.err, null);
				}
			}
			else {
				// simple query syntax
				query = this.parseSearchQuery(query, config);
			}
		}
		
		if (!query.criteria || !query.criteria.length) {
			this.logError('index', "Invalid search query", query);
			return callback(null, {}, {});
		}
		
		this.logDebug(8, "Performing index search", query);
		
		var state = query;
		state.config = config;
		state.record_ids = Object.create(null);
		state.first = true;
		
		// track detailed perf of search operations
		if (!state.perf) {
			state.perf = new Perf();
			state.perf.begin();
		}
		
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
					return callback(null, {}, state);
				}
				crit.def = def;
				
				if (crit.negative) negs.push( crit );
				else stds.push( crit );
			}
		}
		
		// stds need to be weighed and sorted by weight ascending
		var wpf = state.perf.begin('weigh');
		async.eachLimit( (query.mode == 'and') ? stds : [], this.concurrency,
			function(crit, callback) {
				self.weighCriterion(crit, config, callback);
			},
			function(err) {
				wpf.end();
				
				// sort stds by weight ascending (only needed in AND mode)
				if (query.mode == 'and') {
					stds = stds.sort( function(a, b) { return a.weight - b.weight; } );
				}
				
				// generate series of tasks, starting with any sub-queries,
				// then sorted weighed criteria, then negative criteria
				var tasks = [].concat( subs, stds, negs );
				async.eachSeries( tasks,
					function(task, callback) {
						task.perf = state.perf;
						
						if (task.criteria) {
							// sub-query	
							self._searchRecords( task, config, function(err, records) {
								state.perf.count('subs', 1);
								self.mergeIndex( state.record_ids, records, state.first ? 'or' : state.mode );
								state.first = false;
								callback();
							} );
						}
						else if (task.skip) {
							// skip this task (all words removed)
							process.nextTick( function() { callback(); } );
						}
						else if (task.def.type) {
							// custom index type, e.g. date, time, number
							var func = 'searchIndex_' + task.def.type;
							if (!self[func]) return callback( new Error("Unknown index type: " + task.def.type) );
							
							var cpf = state.perf.begin('search_' + task.def.id + '_' + task.def.type);
							self[func]( task, state, function(err) {
								cpf.end();
								state.perf.count(task.def.type + 's', 1);
								callback(err);
							} );
						}
						else if (task.literal) {
							// literal multi-word phrase
							var spf = state.perf.begin('search_' + task.def.id + '_literal');
							self.searchWordIndexLiteral(task, state, function(err) {
								spf.end();
								state.perf.count('literals', 1);
								callback(err);
							});
						}
						else {
							// single word search
							var spf = state.perf.begin('search_' + task.def.id + '_word');
							self.searchWordIndex(task, state, function(err) {
								spf.end();
								state.perf.count('words', 1);
								callback(err);
							});
						}
					},
					function(err) {
						// complete
						if (err) {
							self.logError('index', "Index search failed: " + err);
							state.record_ids = {};
							state.err = err;
						}
						self.logDebug(10, "Search complete", state.record_ids);
						callback(null, state.record_ids, Tools.copyHashRemoveKeys(state, { config:1, record_ids:1, first:1 }));
					}
				); // eachSeries (tasks)
			} // weigh done
		); // eachLimit (weigh)
	},
	
	searchWordIndex: function(query, state, callback) {
		// run one word query (single word against one index)
		var self = this;
		var config = state.config;
		var def = query.def;
		this.logDebug(10, "Running word query", query);
		
		var mode = state.first ? 'or' : state.mode;
		if (query.negative) mode = 'not';
		state.first = false;
		
		var path = config.base_path + '/' + def.id + '/word/' + query.word;
		var cur_items = state.record_ids;
		var new_items = Object.create(null);
		
		// query optimizations
		var num_cur_items = Tools.numKeys(cur_items);
		
		// if current items is empty and mode = and|not, we can exit early
		if (!num_cur_items && ((mode == 'and') || (mode == 'not'))) {
			process.nextTick( callback );
			return;
		}
		
		// Decide on row scan or hash merge:
		// If query weight (hash length) divided by page size is greater than num_cur_items
		// then it would probably be faster to apply the logic using _data getMulti (a.k.a row scan).
		// Otherwise, perform a normal hash merge (which has to read every hash page).
		var hash_page_size = config.hash_page_size || 1000;
		var wpf = state.perf.begin('word_' + query.word);
		
		if ((mode == 'and') && query.weight && (query.weight / hash_page_size > num_cur_items)) {
			this.logDebug(10, "Performing row scan on " + num_cur_items + " items", query);
			
			var record_ids = Object.keys( cur_items );
			var data_paths = record_ids.map( function(record_id) {
				return config.base_path + '/_data/' + record_id;
			} );
			
			var rspf = state.perf.begin('row_scan');
			this.getMulti( data_paths, function(err, datas) {
				rspf.end();
				if (err) return callback(err);
				
				datas.forEach( function(data, idx) {
					var record_id = record_ids[idx];
					if (!data || !data[def.id] || !data[def.id].words || (data[def.id].words.indexOf(query.word) == -1)) {
						delete cur_items[record_id];
					}
				} );
				
				state.perf.count('rows_scanned', datas.length);
				wpf.end();
				callback();
			} ); // getMulti
		} // row scan
		else {
			this.logDebug(10, "Performing '" + mode + "' hash merge on " + num_cur_items + " items", query);
			
			var hmpf = state.perf.begin('hash_merge');
			this.hashEachPage( path,
				function(items, callback) {
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
					state.perf.count('hash_pages', 1);
					callback();
				},
				function(err) {
					hmpf.end();
					wpf.end();
					if (mode == 'and') state.record_ids = new_items;
					callback(err);
				}
			);
		} // hash merge
	},
	
	searchWordIndexLiteral: function(query, state, callback) {
		// run literal search query (list of words which must be in sequence)
		var self = this;
		var def = query.def;
		this.logDebug(10, "Running literal word query", query);
		
		var mode = state.first ? 'or' : state.mode;
		if (query.negative) mode = 'not';
		state.first = false;
		
		var path_prefix = state.config.base_path + '/' + def.id + '/word/';
		var record_ids = state.record_ids;
		
		var temp_results = Object.create(null);
		var temp_idx = 0;
		
		async.eachSeries( query.words,
			function(word, callback) {
				// for each word, iterate over record ids
				var keepers = Object.create(null);
				var wpf = state.perf.begin('literal_' + word);
				
				self.hashEachSync( path_prefix + word,
					function(record_id, raw_value) {
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
					},
					function(err) {
						wpf.end();
						// If in a subsequent word pass, make sure all temp_results
						// ids are still matched in the latest word
						if (temp_idx > 0) self.mergeIndex( temp_results, keepers, 'and' );
						temp_idx++;
						
						callback();
					}
				); // hashEachSync (word)
			},
			function(err) {
				// all done, now merge data into record ids
				for (var record_id in temp_results) {
					temp_results[record_id] = 1; // cleanup values
				}
				
				self.mergeIndex( record_ids, temp_results, mode );
				callback(err);
			}
		);
	},
	
	mergeIndex: function(record_ids, dbh, mode) {
		// Merge record ID keys from index subnode into hash
		switch (mode || 'or') {
			case 'and':
				for (var key in record_ids) {
					if (!(key in dbh)) delete record_ids[key];
				}
			break;
			
			case 'not':
				for (var key in dbh) {
					delete record_ids[key];
				}
			break;
			
			case 'or':
				for (var key in dbh) {
					record_ids[key] = dbh[key];
				}
			break;
		}
	},
	
	sortRecords: function(record_hash, sorter_id, sort_dir, config, callback) {
		// sort records by sorter index
		var self = this;
		if (!sort_dir) sort_dir = 1;
		
		if (self.debugLevel(8)) {
			self.logDebug(8, "Sorting " + Tools.numKeys(record_hash) + " records by " + sorter_id + " (" + sort_dir + ")", {
				path: config.base_path
			});
		}
		
		var sorter = Tools.findObject( config.sorters, { id: sorter_id } );
		if (!sorter) return callback( new Error("Cannot find sorter: " + sorter_id) );
		
		// apply sort values to record hash
		var path = config.base_path + '/' + sorter.id + '/sort';
		var sort_pairs = [];
		var pf = this.perf.begin('sort');
		
		this.hashEachPage( path, 
			function(items, callback) {
				for (var key in items) {
					if (key in record_hash) {
						sort_pairs.push([ key, items[key] ]);
					}
				}
				callback();
			},
			function() {
				// setup comparator function
				var comparator = (sorter.type == 'number') ?
					function(a, b) { return (a[1] - b[1]) * sort_dir; } :
					function(a, b) { return a[1].toString().localeCompare( b[1] ) * sort_dir; };
				
				// now we can sort
				sort_pairs.sort( comparator );
				
				// copy ids back to simple array
				var record_ids = [];
				for (var idx = 0, len = sort_pairs.length; idx < len; idx++) {
					record_ids.push( sort_pairs[idx][0] );
				}
				
				var elapsed = pf.end();
				self.logTransaction('sort', config.base_path, {
					sorter_id: sorter_id,
					sorter_type: sorter.type || 'string',
					sort_dir: sort_dir,
					elapsed_ms: elapsed,
					records: record_ids.length
				});
				
				self.logDebug(8, "Sort complete, returning results");
				callback( null, record_ids, sort_pairs, comparator );
			}
		); // hashEachPage
	},
	
	getFieldSummary: function(id, config, callback) {
		// get field summary for specified field
		this.get( config.base_path + '/' + id + '/summary', function(err, data) {
			if (err) return callback(err);
			if (!data) return callback( new Error("Index field not found: " + config.base_path + '/' + id) );
			if (!data.values) data.values = {};
			data.values = Tools.copyHashRemoveProto( data.values );
			callback( null, data.values );
		} );
	},
	
	cacheRemoveWords: function(config) {
		// cache remove words in hash for speed
		if (!this.removeWordCache) this.removeWordCache = {};
		
		if (this.removeWordCache[config.base_path]) {
			return this.removeWordCache[config.base_path];
		}
		
		// build cache
		var cache = Object.create(null);
		this.removeWordCache[config.base_path] = cache;
		
		for (var idx = 0, len = config.remove_words.length; idx < len; idx++) {
			cache[ config.remove_words[idx] ] = 1;
		}
		
		return cache;
	}
	
});
