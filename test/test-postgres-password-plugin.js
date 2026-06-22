// Unit tests for Postgres password plugin support
// Copyright (c) 2026 Joseph Huckaby
// Released under the MIT License

var cp = require('child_process');
var EventEmitter = require('events').EventEmitter;
var Module = require('module');

var origLoad = Module._load;
var origExec = cp.exec;

// The Postgres engine requires 'pg' at module load time.  Stub it here so this
// focused test can run without needing a live Postgres module or database.
var fakePG = {
	lastConfig: null,
	Pool: function(config) {
		fakePG.lastConfig = config;
		this.on = function() {};
		this.query = function(sql, args, callback) {
			callback( null, { command: 'CREATE', rowCount: 0, rows: [] } );
		};
	}
};

Module._load = function(request, parent, isMain) {
	if (request == 'pg') return fakePG;
	return origLoad.apply( this, arguments );
};

var PostgresEngine = require('../engines/Postgres.js');
Module._load = origLoad;

function makeEngine(config) {
	// Keep this intentionally tiny.  The password plugin helper only needs the
	// component config and log methods, and setup() only needs query logging.
	var engine = Object.create( PostgresEngine.prototype );
	engine.config = {
		get: function() { return config; }
	};
	engine.logDebug = function() {};
	engine.logError = function() {};
	return engine;
}

function mockExec(responder) {
	var calls = [];
	
	cp.exec = function(cmd, opts, callback) {
		var call = { cmd: cmd, opts: opts, stdin: '' };
		var child = { stdin: new EventEmitter() };
		calls.push( call );
		
		child.stdin.write = function(data) {
			call.stdin += data;
		};
		child.stdin.end = function() {
			responder( call, callback );
		};
		
		return child;
	};
	
	return calls;
}

function restoreExec() {
	cp.exec = origExec;
}

module.exports = {
	tests: [
		
		function setup_installsPasswordFunctionAndStripsPluginKeys(test) {
			test.expect(4);
			
			var engine = makeEngine({
				host: 'localhost',
				database: 'test',
				user: 'test',
				password: 'static',
				passwordPlugin: 'node ./plugin.js',
				passwordPluginTimeout: 1234,
				table: 'items'
			});
			
			fakePG.lastConfig = null;
			engine.setup( function(err) {
				test.ok( !err, "Setup completed without error" );
				test.ok( typeof(fakePG.lastConfig.password) == 'function', "Password was converted to a callback function" );
				test.ok( !('passwordPlugin' in fakePG.lastConfig), "passwordPlugin was stripped from pool config" );
				test.ok( !('passwordPluginTimeout' in fakePG.lastConfig), "passwordPluginTimeout was stripped from pool config" );
				test.done();
			} );
		},
		
		function passwordPlugin_returnsPasswordAndSendsConfig(test) {
			test.expect(5);
			
			var engine = makeEngine({
				host: 'localhost',
				database: 'test',
				user: 'tester',
				password: 'static',
				passwordPlugin: 'node ./plugin.js',
				passwordPluginTimeout: 1234,
				table: 'items'
			});
			
			var calls = mockExec( function(call, callback) {
				callback( null, JSON.stringify({ xy: 1, password: 'dynamic-secret' }) + "\n", "" );
			} );
			
			engine.getPasswordFromPlugin().then( function(password) {
				var input = JSON.parse( calls[0].stdin );
				
				test.ok( password == 'dynamic-secret', "Returned dynamic password" );
				test.ok( calls[0].cmd == 'node ./plugin.js', "Used configured plugin command" );
				test.ok( calls[0].opts.timeout == 1234, "Used configured plugin timeout" );
				test.ok( input.type == 'postgres_password', "Sent expected hook type" );
				test.ok( !('password' in input.config), "Static password was omitted from plugin input" );
				
				restoreExec();
				test.done();
			} ).catch( function(err) {
				restoreExec();
				test.ok( false, "Unexpected error: " + err );
				test.done();
			} );
		},
		
		function passwordPlugin_cachesPasswordForTTL(test) {
			test.expect(3);
			
			var engine = makeEngine({
				passwordPlugin: 'node ./plugin.js',
				table: 'items'
			});
			
			var calls = mockExec( function(call, callback) {
				callback( null, JSON.stringify({ xy: 1, password: 'cached-secret', ttl: 60 }) + "\n", "" );
			} );
			
			engine.getPasswordFromPlugin().then( function(first) {
				return engine.getPasswordFromPlugin().then( function(second) {
					test.ok( first == 'cached-secret', "First password was returned" );
					test.ok( second == 'cached-secret', "Second password was returned from cache" );
					test.ok( calls.length == 1, "Plugin was only invoked once" );
					
					restoreExec();
					test.done();
				} );
			} ).catch( function(err) {
				restoreExec();
				test.ok( false, "Unexpected error: " + err );
				test.done();
			} );
		},
		
		function passwordPlugin_doesNotCacheWithoutTTL(test) {
			test.expect(2);
			
			var counter = 0;
			var engine = makeEngine({
				passwordPlugin: 'node ./plugin.js',
				table: 'items'
			});
			
			var calls = mockExec( function(call, callback) {
				counter++;
				callback( null, JSON.stringify({ xy: 1, password: 'secret-' + counter }) + "\n", "" );
			} );
			
			engine.getPasswordFromPlugin().then( function(first) {
				return engine.getPasswordFromPlugin().then( function(second) {
					test.ok( first != second, "Passwords were fetched separately" );
					test.ok( calls.length == 2, "Plugin was invoked twice" );
					
					restoreExec();
					test.done();
				} );
			} ).catch( function(err) {
				restoreExec();
				test.ok( false, "Unexpected error: " + err );
				test.done();
			} );
		},
		
		function passwordPlugin_coalescesConcurrentFetches(test) {
			test.expect(2);
			
			var engine = makeEngine({
				passwordPlugin: 'node ./plugin.js',
				table: 'items'
			});
			
			var calls = mockExec( function(call, callback) {
				setTimeout( function() {
					callback( null, JSON.stringify({ xy: 1, password: 'shared-secret', ttl: 60 }) + "\n", "" );
				}, 10 );
			} );
			
			Promise.all([
				engine.getPasswordFromPlugin(),
				engine.getPasswordFromPlugin(),
				engine.getPasswordFromPlugin()
			]).then( function(passwords) {
				test.ok( passwords.join(',') == 'shared-secret,shared-secret,shared-secret', "All callers received the same password" );
				test.ok( calls.length == 1, "Only one plugin process was spawned" );
				
				restoreExec();
				test.done();
			} ).catch( function(err) {
				restoreExec();
				test.ok( false, "Unexpected error: " + err );
				test.done();
			} );
		},
		
		function passwordPlugin_reportsPluginError(test) {
			test.expect(1);
			
			var engine = makeEngine({
				passwordPlugin: 'node ./plugin.js',
				table: 'items'
			});
			
			mockExec( function(call, callback) {
				callback( null, JSON.stringify({ xy: 1, code: 'auth', description: 'Token rejected' }) + "\n", "" );
			} );
			
			engine.getPasswordFromPlugin().then( function() {
				restoreExec();
				test.ok( false, "Expected plugin error" );
				test.done();
			} ).catch( function(err) {
				restoreExec();
				test.ok( /Token rejected/.test(err.message), "Reported plugin error: " + err.message );
				test.done();
			} );
		}
		
	]
};
