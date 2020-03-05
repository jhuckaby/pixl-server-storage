// Unit tests for Storage System - Indexer
// Copyright (c) 2015 - 2016 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');
var Tools = require('pixl-tools');

var sample_data = require('./sample-data.json');
var sample_tickets = sample_data.Ticket;

var index_config = {
	base_path: "/index/ontrack",
	fields: [
		{
			id: "status",
			source: "/Status",
			master_list: 1
		},
		{
			id: "title",
			source: "/Summary",
			min_word_length: 3,
			max_word_length: 128,
			use_remove_words: 1
		},
		{
			id: "modified",
			source: "/Modifydate",
			type: "date"
		},
		{
			id: "num_comments",
			source: "/Comments/Comment/length",
			type: "number"
		}
	],
	
	sorters: [
		{
			id: "created",
			source: "/Createdate",
			type: "number"
		}
	],
	
	remove_words: ["the","of","and","a","to","in","is","you","that","it","he","was","for","on","are","as","with","his","they","I","at","be","this","have","from","or","one","had","by","word","but","not","what","all","were","we","when","your","can","said","there","use","an","each","which","she","do","how","their","if","will","up","other","about","out","many","then","them","these","so","some","her","would","make","like","him","into","time","has","look","two","more","write","go","see","number","no","way","could","people","my","than","first","water","been","call","who","oil","its","now","find","long","down","day","did","get","come","made","may","part"]
};

var fixtures = {
	searchRecordsExact2: {
		'title:"Released to Preproduction"': { "2653": 1, "2654": 1, "2659": 1, "2662": 1, "2665": 1 },
		'status:open title:"Released to Preproduction"': { "2653": 1, "2654": 1 },
		'status:closed title:"Released to Preproduction"': { "2659": 1, "2662": 1, "2665": 1 },
		'status:open title:"Released to Preproduction" -service +product': { "2653": 1 },
		'status:open title:"Released to Preproduction" +service -product': { "2654": 1 },
		
		'status:open title:"Released to" +"Preproduction"': { "2653": 1, "2654": 1 },
		
		'status:open title:"Product 1.7.70 Released" -"Preproduction hzd86vdxtd"': { "2653": 1 },
		'status:open title:"Service 1.1.38 Released" +"Preproduction hzd86vdxtd"': { "2654": 1 },
		
		'title:"xchfqkk6d4"': { "2662": 1 },
		'title:"Increase CLEAR thresholds"': { "2663": 1 },
		'title:"Increase CLEAR alert thresholds"': { "2664": 1 },
		'title:"prod idb01" +idb02 status:closed': { "2661": 1 },
		'title:"prod idb03" +idb02 status:closed': {},
		'title:"prod idb01" +idb03 status:closed': {},
		'title:"prod idb01" +idb02 status:open': {},
		'title:"Released to PreproductionZ"': {},
		'title:"KJFHSDLKFHLKSDFHKJDSF"': {},
		'title:"0"': {},
		'title:"a"': {},
		'title:""': {}
	},
	searchRecordsDateExact: {
		'modified:2016-02-21': {},
		
		'modified:2016-02-22': { "2656": 1 },
		'modified:2016/02/22': { "2656": 1 },
		'modified:2016_02_22': { "2656": 1 },
		'modified:1456164397': { "2656": 1 }, // epoch date
		
		'modified:2016-02-23': { "2658": 1 },
		'modified:2016-02-25': { "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1 },
		'modified:2016-02-29': { "2662": 1, "2663": 1, "2664": 1 },
		'modified:2016-03-03': { "2665": 1 },
		'modified:2016-05-06': { "2661": 1 },
		'modified:2016-05-07': {},
		'modified:2016-02-22 | 2016-02-23': { "2656": 1, "2658": 1 },
		'modified:2016-03-03 | 2016-05-06': { "2665": 1, "2661": 1 },
		'modified:2016-02-22 | 2016-02-23 | 2016-03-03 | 2016-05-06': { "2656": 1, "2658": 1, "2665": 1, "2661": 1 }
	},
	searchRecordsDateRangeOpen: {
		'modified:<2000-01-01': {},
		'modified:<2016-02-22': {},
		
		'modified:<=2016-02-22': { "2656": 1 },
		'modified:<2016-02-23': { "2656": 1 },
		
		'modified:>=2000-01-01': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'modified:>=2016-02-22': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		'modified:>2016-02-22': { "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'modified:>=2016-02-29': { "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		'modified:>2016-02-29': { "2665": 1, "2661": 1 },
		
		'modified:>=2016-03-03': { "2665": 1, "2661": 1 },
		'modified:>2016-03-03': { "2661": 1 },
		
		'modified:<=2016-05-06': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		'modified:<2016-05-06': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1 },
		
		'modified:>2016-05-06': {},
		'modified:>2020-12-31': {}
	},
	searchRecordsDateRangeClosed: {
		'modified:2000-01-01..2016-02-21': {},
		'modified:2000-01-01..2016-02-22': { "2656": 1 },
		'modified:2016-02-22..2016-02-24': { "2656": 1, "2658": 1 },
		'modified:2016-02-24..2016-02-28': { "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1 },
		'modified:2016-02-29..2016-02-29': { "2662": 1, "2663": 1, "2664": 1 },
		'modified:2016-03-01..2020-12-31': { "2665": 1, "2661": 1 },
		'modified:2016-05-04..2016-05-05': {},
		'modified:2016-05-07..2016-06-01': {}
	},
	searchRecordsNumberExact: {
		'num_comments:0': { "2660": 1 },
		'num_comments:1': { "2656": 1 },
		'num_comments:2': { "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		'num_comments:3': {},
		'num_comments:4': { "2653": 1, "2659": 1, "2662": 1, "2665": 1 },
		'num_comments:5': { "2654": 1 },
		'num_comments:6': { "2655": 1 },
		'num_comments:7': {},
		'num_comments:99999': {},
		'num_comments:0|1': { "2660": 1, "2656": 1 },
		'num_comments:5|6': { "2654": 1, "2655": 1 },
		'num_comments:0|1|5|6': { "2660": 1, "2656": 1, "2654": 1, "2655": 1 }
	},
	searchRecordsNumberRangeOpen: {
		'num_comments:<0': {},
		'num_comments:<=0': { "2660": 1 },
		
		'num_comments:>=0': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:>0': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:<1': { "2660": 1 },
		'num_comments:<=1': { "2660": 1, "2656": 1 },
		
		'num_comments:>=1': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:>1': { "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:<3': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		'num_comments:<=3': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		
		'num_comments:>=3': { "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:>3': { "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		
		'num_comments:>=5': { "2655": 1, "2654": 1 },
		'num_comments:>5': { "2655": 1 },
		
		'num_comments:>=6': { "2655": 1 },
		'num_comments:>6': {},
		
		'num_comments:>=7': {},
		'num_comments:>7': {},
		'num_comments:>99999': {},
		
		'num_comments:<=6': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:<7': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'num_comments:<99999': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 }
	},
	searchRecordsNumberRangeClosed: {
		'num_comments:0..0': { "2660": 1 },
		'num_comments:0..1': { "2660": 1, "2656": 1 },
		'num_comments:0..2': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		'num_comments:0..3': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		'num_comments:0..4': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1 },
		'num_comments:0..5': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1 },
		'num_comments:0..6': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:0..7': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:0..99999': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		
		'num_comments:1..6': { "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:2..6': { "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:3..6': { "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:4..6': { "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 },
		'num_comments:5..6': { "2654": 1, "2655": 1 },
		'num_comments:6..6': { "2655": 1 },
		
		'num_comments:6..7': { "2655": 1 },
		'num_comments:6..99999': { "2655": 1 },
		'num_comments:7..7': {},
		'num_comments:7..99999': {},
		
		// 'num_comments:0..0': { "2660": 1 },
		'num_comments:1..1': { "2656": 1 },
		'num_comments:2..2': { "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		'num_comments:3..3': {},
		'num_comments:4..4': { "2653": 1, "2659": 1, "2662": 1, "2665": 1 },
		'num_comments:5..5': { "2654": 1 },
		// 'num_comments:6..6': { "2655": 1 }
	},
	searchRecordsAll: {
		'*': { "2660": 1, "2656": 1, "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1, "2653": 1, "2659": 1, "2662": 1, "2665": 1, "2654": 1, "2655": 1 }
	},
	searchRecordsPxQL: {
		// basic
		'(title =~ "xchfqkk6d4")': { "2662": 1 },
		'(title =~ "Released to Preproduction")': { "2653": 1, "2654": 1, "2659": 1, "2662": 1, "2665": 1 },
		'(status = "open" & title =~ "Released to Preproduction")': { "2653": 1, "2654": 1 },
		'(status = "closed" & title =~ "Released to Preproduction")': { "2659": 1, "2662": 1, "2665": 1 },
		
		// useless extra parens
		'(status = "closed" & (title =~ "Released to Preproduction"))': { "2659": 1, "2662": 1, "2665": 1 },
		'((status = "closed") & title =~ "Released to Preproduction")': { "2659": 1, "2662": 1, "2665": 1 },
		'((status = "closed") & (title =~ "Released to Preproduction"))': { "2659": 1, "2662": 1, "2665": 1 },
		
		// date formats
		'(modified = "2016-02-22")': { "2656": 1 },
		'(modified = "2016/02/22")': { "2656": 1 },
		'(modified = "2016_02_22")': { "2656": 1 },
		'(modified = "1456164397")': { "2656": 1 }, // epoch date
		
		// date ranges
		'(modified < "2000-01-01")': {},
		'(modified < "2016-02-22")': {},
		
		'(modified <= "2016-02-22")': { "2656": 1 },
		'(modified < "2016-02-23")': { "2656": 1 },
		
		'(modified<="2016-02-22")': { "2656": 1 }, // no spaces
		'(modified<"2016-02-23")': { "2656": 1 }, // no spaces
		
		// numbers
		'(num_comments = 0)': { "2660": 1 },
		'(num_comments = 1)': { "2656": 1 },
		'(num_comments = 2)': { "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 },
		
		'(num_comments = "0")': { "2660": 1 }, // quotes should work with numbers
		'(num_comments = "1")': { "2656": 1 }, // quotes should work with numbers
		'(num_comments = "2")': { "2657": 1, "2658": 1, "2661": 1, "2663": 1, "2664": 1 }, // quotes should work with numbers
		
		'(num_comments < 0)': {},
		'(num_comments <= 0)': { "2660": 1 },
		
		'(num_comments >= 0)': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2660": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'(num_comments > 0)': { "2656": 1, "2658": 1, "2653": 1, "2654": 1, "2655": 1, "2657": 1, "2659": 1, "2662": 1, "2663": 1, "2664": 1, "2665": 1, "2661": 1 },
		
		'(num_comments < 1)': { "2660": 1 },
		'(num_comments <= 1)': { "2660": 1, "2656": 1 },
		
		// complex boolean
		'((status = "open" | status = "closed" | status = "wallaby") & (title =~ "amazon" & title =~ "monitor") & modified = "2016_02_22")': { "2656": 1 },
		
		// bad queries (expect errors)
		'(nonexist = "foo")': false, // index not found
		'(title =~ "preproduction" ^^ status = "open")': false, // invalid operator
		'(title =~ "preproduction" && status = "open)': false, // missing close quote
		'(title =~ "preproduction" && status = "open"))': false, // double close paren
		'(title =~ "preproduction" && (status = "open")': false // missing close paren
	},
	searchRecordsMultiDate: {
		'modified:2016-03-03': { "2665": 1 },
		'modified:2016-03-04': { "2665": 1 },
		'modified:2016-03-05': { "2665": 1 },
		
		'modified:>=2016-03-03': { "2661": 1, "2665": 1 },
		'modified:>=2016-03-04': { "2661": 1, "2665": 1 },
		'modified:>=2016-03-05': { "2661": 1, "2665": 1 },
		'modified:>=2016-03-06': { "2661": 1 },
		
		'modified:2016-03-03..2016-03-05': { "2665": 1 },
		'modified:2016-03-02..2016-03-03': { "2665": 1 },
		'modified:2016-03-05..2016-03-06': { "2665": 1 },
		'modified:2016-03-02..2016-03-06': { "2665": 1 },
		'modified:2016-03-01..2016-03-02': {},
		'modified:2016-03-06..2016-03-07': {}
	},
	searchRecordsBadKeys: {
		'title:control1': { "2665": 1 },
		'title:control2': { "2665": 1 },
		'title:control1 control2': { "2665": 1 },
		'title:"control1 control2"': {},
		
		'title:constructor': { "2665": 1 },
		'title:__defineGetter__': { "2665": 1 }, 
		'title:__defineSetter__': { "2665": 1 }, 
		'title:hasOwnProperty': { "2665": 1 }, 
		'title:__lookupGetter__': { "2665": 1 }, 
		'title:__lookupSetter__': { "2665": 1 }, 
		'title:isPrototypeOf': { "2665": 1 }, 
		'title:propertyIsEnumerable': { "2665": 1 }, 
		'title:toString': { "2665": 1 }, 
		'title:valueOf': { "2665": 1 }, 
		'title:__proto__': { "2665": 1 }, 
		'title:toLocaleString': { "2665": 1 },
		
		'title:"control1 constructor"': { "2665": 1 },
		'title:"toLocaleString control2"': { "2665": 1 },
		'title:"toLocaleString constructor"': {},
		
		'title:control1 -__proto__': {},
		'title:toLocaleString -__proto__': {}
	}
};

module.exports = {
	tests: [
	
		// insert record
		
		function insertRecord1(test) {
			var self = this;
			
			var ticket = sample_tickets[0];
			
			this.storage.indexRecord( ticket.ID, ticket, index_config, function(err) {
				test.ok( !err, "No error indexing record: " + err );
				test.done();
			} );
		},
		
		// simple searches
		
		function searchRecord1(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:open', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2653", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		function searchRecord2(test) {
			// test negative (false) search
			var self = this;
			
			this.storage.searchRecords( 'status:closed', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 0, "Found exactly zero records: " + keys.length );
				
				test.done();
			} );
		},
		
		// update record
		
		function updateRecord1(test) {
			var self = this;
			
			// Note: this is a SPARSE update, missing some fields and sorters
			var update = {
				ID: "2653",
				Status: "Closed",
				Summary: "This has been updated the of and a to test12345"
			};
			
			this.storage.indexRecord( update.ID, update, index_config, function(err) {
				test.ok( !err, "No error updating record: " + err );
				test.done();
			} );
		},
		
		// search again
		
		function searchRecord3(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:closed', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2653", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		function searchRecord4(test) {
			// test negative (false) search (again)
			var self = this;
			
			this.storage.searchRecords( 'status:open', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 0, "Found exactly zero records: " + keys.length );
				
				test.done();
			} );
		},
		
		function searchRecord5(test) {
			var self = this;
			
			this.storage.searchRecords( 'title:This has been updated the of and a to test12345', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2653", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		function searchRecord6(test) {
			var self = this;
			
			this.storage.searchRecords( 'title:updated test12345', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2653", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		function searchRecord7(test) {
			// test negative (false) search (again)
			var self = this;
			
			this.storage.searchRecords( 'title:updatedZ test123456', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 0, "Found exactly zero records: " + keys.length );
				
				test.done();
			} );
		},
		
		// unindex record
		
		function unindexRecord1(test) {
			var self = this;
			
			this.storage.unindexRecord( "2653", index_config, function(err) {
				test.ok( !err, "No error indexing record: " + err );
				test.done();
			} );
		},
		
		function searchRecord8(test) {
			// test negative (false) search (again)
			var self = this;
			
			this.storage.searchRecords( 'title:test12345', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 0, "Found exactly zero records: " + keys.length );
				
				test.done();
			} );
		},
		
		// insert records
		
		function insertRecords(test) {
			var self = this;
			
			async.eachSeries( sample_tickets,
				function(ticket, callback) {
					self.storage.indexRecord( ticket.ID, ticket, index_config, callback );
				},
				function(err) {
					test.ok( !err, "No error indexing records: " + err );
					test.done();
				}
			);
		},
		
		// search records
		
		function searchRecordsBasic1(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:open', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var correct = {};
				Tools.findObjects( sample_tickets, { Status: "Open" } ).forEach( function(ticket) {
					correct[ ticket.ID ] = 1;
				} );
				
				test.ok( Tools.numKeys(results) == Tools.numKeys(correct), "Correct number of records found" );
				
				test.ok( Tools.numKeys( Tools.mergeHashes(results, correct) ) == Tools.numKeys(results), "Correct records found: " + JSON.stringify(results) );
				test.done();
			} );
		},
		
		function searchRecordsBasic2(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:closed', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var correct = {};
				Tools.findObjects( sample_tickets, { Status: "Closed" } ).forEach( function(ticket) {
					correct[ ticket.ID ] = 1;
				} );
				
				test.ok( Tools.numKeys(results) == Tools.numKeys(correct), "Correct number of records found" );
				
				test.ok( Tools.numKeys( Tools.mergeHashes(results, correct) ) == Tools.numKeys(results), "Correct records found: " + JSON.stringify(results) );
				test.done();
			} );
		},
		
		// search with negatives
		
		function searchRecordsNegative(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:open title:-hzd86vdxtd', index_config, function(err, results) {
				test.ok( !err, "No error searching record: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2653", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		// search extact phrase
		
		function searchRecordsExact(test) {
			var self = this;
			
			var map = {};
			sample_tickets.forEach( function(ticket) {
				var expected = {}; expected[ticket.ID] = 1;
				map[ 'title:"'+ticket.Summary+'"' ] = expected;
			} );
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		function searchRecordsExact2(test) {
			var self = this;
			var map = fixtures.searchRecordsExact2;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search date exact
		
		function searchRecordsDateExact(test) {
			var self = this;
			var map = fixtures.searchRecordsDateExact;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search open date range
		
		function searchRecordsDateRangeOpen(test) {
			var self = this;
			var map = fixtures.searchRecordsDateRangeOpen;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search closed date range
		
		function searchRecordsDateRangeClosed(test) {
			var self = this;
			var map = fixtures.searchRecordsDateRangeClosed;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search number exact
		
		function searchRecordsNumberExact(test) {
			var self = this;
			var map = fixtures.searchRecordsNumberExact;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search number range open
		
		function searchRecordsNumberRangeOpen(test) {
			var self = this;
			var map = fixtures.searchRecordsNumberRangeOpen;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search number range closed
		
		function searchRecordsNumberRangeClosed(test) {
			var self = this;
			var map = fixtures.searchRecordsNumberRangeClosed;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		function searchRecordsAll(test) {
			var self = this;
			var map = fixtures.searchRecordsAll;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		// search complex boolean
		
		function searchRecordsComplexBoolean(test) {
			var self = this;
			
			var query = {
				mode: "and",
				criteria: [
					{
						mode: "or",
						criteria: [
							{ index: "status", word: "open" },
							{ index: "status", word: "closed" },
							{ index: "status", word: "wallaby" }
						]
					},
					{
						mode: "and",
						criteria: [
							{ index: "title", word: "amazon" },
							{ index: "title", word: "monitor" }
						]
					},
					{ index: "modified", word: "2016_02_22" }
				]
			};
			
			this.storage.searchRecords( query, index_config, function(err, results) {
				test.ok( !err, "No error searching records: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var keys = Object.keys(results);
				test.ok( keys.length == 1, "Found exactly one record: " + keys.length );
				test.ok( keys[0] == "2656", "Found correct record: " + keys[0] );
				
				test.done();
			} );
		},
		
		function searchRecordsPxQL(test) {
			var self = this;
			var map = fixtures.searchRecordsPxQL;
			
			this.multiIndexSearch(map, index_config, test, function() {
				test.done();
			});
		},
		
		function searchSingleRecords(test) {
			// test known set of searches and results on each record
			var self = this;
			var all_records = fixtures.searchRecordsAll['*'];
			var searches = [];
			
			var map = {};
			['searchRecordsExact2', 'searchRecordsDateExact', 'searchRecordsDateRangeOpen', 'searchRecordsDateRangeClosed', 'searchRecordsNumberExact', 'searchRecordsNumberRangeOpen', 'searchRecordsNumberRangeClosed', 'searchRecordsAll', 'searchRecordsPxQL'].forEach( function(cat) {
				Tools.mergeHashInto( map, fixtures[cat] );
			});
			
			for (var query in map) {
				var expected = map[query];
				if (expected) {
					for (var record_id in expected) {
						searches.push({ query: query, record_id: record_id, result: true });
					}
					for (var record_id in all_records) {
						if (!(record_id in expected)) {
							searches.push({ query: query, record_id: record_id, result: false });
						}
					}
				}
			}
			
			async.eachSeries( searches,
				function(search, callback) {
					var squery = search.query;
					var record_id = search.record_id;
					var expected_result = search.result;
					
					self.storage.searchSingle( squery, record_id, index_config, function(err, result) {
						test.ok( !err, "No error searching record: " + err );
						
						test.debug("Single Search: "+squery+" -- result for " + record_id + ": " + result);
						test.ok( result === expected_result, "Got correct results from search: " + result );
						
						callback();
					}); // searchSingle
				},
				function(err) {
					// all searches complete
					test.done();
				}
			); // eachSeries
		},
		
		// sort records
		
		function sortRecords(test) {
			var self = this;
			
			this.storage.searchRecords( 'status:open|closed', index_config, function(err, results) {
				test.ok( !err, "No error searching records: " + err );
				
				test.debug("Search results:", results);
				test.ok( !!results, "Got results from search" );
				test.ok( typeof(results) == 'object', "Results is an object: " + typeof(results) );
				
				var correct = [];
				var correct_ids = [];
				for (var id in results) {
					var ticket = Tools.findObject( sample_tickets, { ID: id } );
					correct.push({ id: id, created: parseInt(ticket.Createdate) });
				}
				correct = correct.sort( function(a, b) {
					return a.created - b.created;
				} );
				correct.forEach( function(obj) {
					correct_ids.push( obj.id );
				} );
				
				test.debug("Correct order:", correct);
				
				self.storage.sortRecords(results, 'created', 1, index_config, function(err, sorted) {
					test.ok( !err, "No error sorting records: " + err );
					
					test.ok( !!sorted, "Got sorted results" );
					test.ok( !!sorted.length, "Sorted results has a length" );
					
					test.debug("Got sorted tickets:", sorted);
					
					test.ok( sorted.join('|') == correct_ids.join('|'), "Correct sort order: " + sorted.join('|') );
					
					test.done();
				}); // sortRecords
			}); // searchRecords
		},
		
		function testMultiDate(test) {
			var self = this;
			var map = fixtures.searchRecordsMultiDate;
			
			// Note: this is a sparse update, missing some fields and sorters
			var update = {
				ID: "2665",
				// "Modifydate": "1457051382 1457137782 1457224182",
				"Modifydate": "2016/03/03, 2016/03/04, 2016/03/05",
			};
			
			this.storage.indexRecord( update.ID, update, index_config, function(err) {
				test.ok( !err, "No error updating record: " + err );
				
				self.multiIndexSearch(map, index_config, test, function() {
					test.done();
				});
			} );
		},
		
		function testBadPropertyNames(test) {
			var self = this;
			var map = fixtures.searchRecordsBadKeys;
			
			// Note: this is a sparse update, missing some fields and sorters
			var update = {
				ID: "2665",
				"Summary": "control1, constructor, __defineGetter__, __defineSetter__, hasOwnProperty, __lookupGetter__, __lookupSetter__, isPrototypeOf, propertyIsEnumerable, toString, valueOf, __proto__, toLocaleString, control2"
			};
			
			this.storage.indexRecord( update.ID, update, index_config, function(err) {
				test.ok( !err, "No error updating record: " + err );
				
				self.multiIndexSearch(map, index_config, test, function() {
					test.done();
				});
			} );
		},
		
		function testBadRecordID(test) {
			// add a record with a toxic ID, make sure it can be indexed and searched
			var self = this;
			var bad_ticket = {
				ID: "constructor",
				Summary: "hello frogtoad there"
			};
			var map = {
				'title:frogtoad': { "constructor": 1 },
				'title:"hello frogtoad"': { "constructor": 1 },
				'title:frogtoad -constructor': { "constructor": 1 }
			};
			
			// push onto sample_tickets so it gets cleaned up in unindexAllRecords
			sample_tickets.push(bad_ticket);
			
			this.storage.indexRecord( bad_ticket.ID, bad_ticket, index_config, function(err) {
				test.ok( !err, "No error inserting record: " + err );
				
				self.multiIndexSearch(map, index_config, test, function() {
					test.done();
				});
			}); // indexRecord
		},
		
		function testDoubleWordExactMatch(test) {
			// add a record with a repeating word, and search for exact phrases
			var self = this;
			var ticket = {
				ID: "double1",
				Summary: "lost dog dog park"
			};
			var map = {
				'title:"lost dog"': { "double1": 1 },
				'title:"lost dog dog"': { "double1": 1 },
				'title:"lost dog dog park"': { "double1": 1 },
				'title:"dog dog park"': { "double1": 1 },
				'title:"dog park"': { "double1": 1 },
				'title:"park dog"': {},
				'title:"lost park"': {},
				'title:"dog lost"': {},
				'title:"dog dog park park"': {},
				'title:"dog dog dog"': {}
			};
			
			// push onto sample_tickets so it gets cleaned up in unindexAllRecords
			sample_tickets.push(ticket);
			
			this.storage.indexRecord( ticket.ID, ticket, index_config, function(err) {
				test.ok( !err, "No error inserting record: " + err );
				
				self.multiIndexSearch(map, index_config, test, function() {
					test.done();
				});
			}); // indexRecord
		},
		
		function testDoubleWordRemoveWordExactMatch(test) {
			// add a record with a repeating word, and search for exact phrases
			// this time with remove words inserted
			var self = this;
			var ticket = {
				ID: "double2",
				Summary: "lost dog in the dog park"
			};
			var map = {
				'title:"lost dog"': { "double1": 1, "double2": 1 },
				'title:"lost dog dog"': { "double1": 1, "double2": 1 },
				'title:"lost dog dog park"': { "double1": 1, "double2": 1 },
				'title:"dog dog park"': { "double1": 1, "double2": 1 },
				'title:"dog park"': { "double1": 1, "double2": 1 },
				'title:"park dog"': {},
				'title:"lost park"': {},
				'title:"dog lost"': {},
				'title:"dog dog park park"': {},
				'title:"dog dog dog"': {}
			};
			
			// push onto sample_tickets so it gets cleaned up in unindexAllRecords
			sample_tickets.push(ticket);
			
			this.storage.indexRecord( ticket.ID, ticket, index_config, function(err) {
				test.ok( !err, "No error inserting record: " + err );
				
				self.multiIndexSearch(map, index_config, test, function() {
					test.done();
				});
			}); // indexRecord
		},
		
		function unindexAllRecords(test) {
			// unindex all records to remove temp disk space
			var self = this;
			
			async.eachSeries( sample_tickets,
				function(ticket, callback) {
					self.storage.unindexRecord( ticket.ID, index_config, callback );
				},
				function(err) {
					test.ok( !err, "No error unindexing records: " + err );
					test.done();
				}
			);
		},
		
		function indexerCleanup(test) {
			// remove data leftover by indexer
			var self = this;
			
			async.eachSeries( index_config.fields,
				function(def, callback) {
					if (def.master_list) {
						self.storage.delete( index_config.base_path + '/' + def.id + '/summary', callback );
					}
					else process.nextTick(callback);
				},
				function(err) {
					test.ok( !err, "No error cleaning up indexer: " + err );
					
					// and now the sorters
					async.eachSeries( index_config.sorters || [],
						function(sorter, callback) {
							self.storage.hashDeleteAll( index_config.base_path + '/' + sorter.id + '/sort', true, callback );
						},
						function(err) {
							test.ok( !err, "No error cleaning up sorters: " + err );
							
							// finally the primary _id hash
							self.storage.hashDeleteAll( index_config.base_path + '/_id', true, function(err) {
								test.ok( !err, "No error cleaning up indexer _id hash: " + err );
								test.done();
							} );
						} // done with sorters
					); // each sorter
				} // done with fields
			); // each field
		}
		
	] // tests array
};
