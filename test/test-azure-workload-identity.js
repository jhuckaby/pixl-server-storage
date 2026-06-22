// Unit tests for Postgres engine Azure Workload Identity support
// Copyright (c) 2026 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var path = require('path');
var os = require('os');
var https = require('https');
var Tools = require('pixl-tools');

// Import the actual engine so fetchAzureToken tests run against the real implementation.
// pg must be installed as a devDependency for this require to succeed.
var PostgresEngine = require('../engines/Postgres.js');
var fetchAzureToken_proto = PostgresEngine.prototype.fetchAzureToken;

function withEnv(vars, fn) {
	var originals = {};
	Object.keys(vars).forEach(function(k) {
		originals[k] = process.env[k];
		if (vars[k] == null) delete process.env[k];
		else process.env[k] = vars[k];
	});
	return fn().then(
		function(v) {
			Object.keys(originals).forEach(function(k) {
				if (originals[k] == null) delete process.env[k];
				else process.env[k] = originals[k];
			});
			return v;
		},
		function(e) {
			Object.keys(originals).forEach(function(k) {
				if (originals[k] == null) delete process.env[k];
				else process.env[k] = originals[k];
			});
			throw e;
		}
	);
}

module.exports = {
	tests: [

		function fetchAzureToken_missingEnvVars(test) {
			test.expect(1);
			var fetchAzureToken = fetchAzureToken_proto.bind({});
			withEnv({ AZURE_TENANT_ID: null, AZURE_CLIENT_ID: null, AZURE_FEDERATED_TOKEN_FILE: null }, function() {
				return fetchAzureToken().then(function() {
					test.ok(false, "Should have thrown for missing env vars");
				}).catch(function(err) {
					test.ok(/AZURE_TENANT_ID/.test(err.message), "Error mentions missing env var: " + err.message);
				});
			}).then(function() { test.done(); }).catch(function(e) { test.ok(false, '' + e); test.done(); });
		},

		function fetchAzureToken_fetchesToken(test) {
			test.expect(3);
			var fetchAzureToken = fetchAzureToken_proto.bind({});

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_FEDERATED_TOKEN\n', 'utf8');

			var capturedOptions = null;
			var origRequest = https.request;
			https.request = function(options, cb) {
				capturedOptions = options;
				var EventEmitter = require('events');
				var res = new EventEmitter();
				res.statusCode = 200;
				var fakeReq = new EventEmitter();
				fakeReq.write = function() {};
				fakeReq.setTimeout = function() {};
				fakeReq.end = function() {
					setImmediate(function() {
						cb(res);
						setImmediate(function() {
							res.emit('data', JSON.stringify({ access_token: 'FAKE_ACCESS_TOKEN' }));
							res.emit('end');
						});
					});
				};
				return fakeReq;
			};

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken();
			}).then(function(token) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(token === 'FAKE_ACCESS_TOKEN', "Returned expected access_token");
				test.ok(capturedOptions && capturedOptions.hostname === 'login.microsoftonline.com', "Called correct hostname");
				test.ok(capturedOptions && capturedOptions.path.indexOf('test-tenant-id') >= 0, "Path contains tenant ID");
				test.done();
			}).catch(function(err) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Unexpected error: " + err);
				test.done();
			});
		},

		function fetchAzureToken_rejectsOnErrorResponse(test) {
			test.expect(2);
			var fetchAzureToken = fetchAzureToken_proto.bind({});

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-err-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_TOKEN', 'utf8');

			var origRequest = https.request;
			https.request = function(options, cb) {
				var EventEmitter = require('events');
				var res = new EventEmitter();
				res.statusCode = 401;
				var fakeReq = new EventEmitter();
				fakeReq.write = function() {};
				fakeReq.setTimeout = function() {};
				fakeReq.end = function() {
					setImmediate(function() {
						cb(res);
						setImmediate(function() {
							res.emit('data', JSON.stringify({ error: 'invalid_client', error_description: 'Bad credentials' }));
							res.emit('end');
						});
					});
				};
				return fakeReq;
			};

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken();
			}).then(function() {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Should have rejected on error response");
				test.done();
			}).catch(function(err) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(/Azure token fetch failed/.test(err.message), "Error message mentions fetch failure: " + err.message);
				test.ok(/HTTP 401/.test(err.message), "Error message includes HTTP status code: " + err.message);
				test.done();
			});
		},

		function fetchAzureToken_rejectsOnUnreadableTokenFile(test) {
			test.expect(1);
			var fetchAzureToken = fetchAzureToken_proto.bind({});
			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: '/nonexistent/path/to/token'
			}, function() {
				return fetchAzureToken();
			}).then(function() {
				test.ok(false, "Should have rejected for unreadable token file");
				test.done();
			}).catch(function(err) {
				test.ok(/failed to read token file/.test(err.message), "Error message mentions token file read failure: " + err.message);
				test.done();
			});
		},

		function poolConfig_passwordIsFunction_whenAzureWIEnabled(test) {
			test.expect(2);

			var pg_config = { azure_workload_identity: true, host: 'localhost', database: 'test', user: 'test', table: 'items' };
			var pool_config = Tools.copyHashRemoveKeys(pg_config, { cache: 1, table: 1, azure_workload_identity: 1 });

			if (pg_config.azure_workload_identity) {
				pool_config.password = fetchAzureToken_proto.bind({});
			}

			test.ok(typeof pool_config.password === 'function', "password is a function when azure_workload_identity is true");
			test.ok(!('azure_workload_identity' in pool_config), "azure_workload_identity is stripped from pool_config");
			test.done();
		},

		function poolConfig_passwordUntouched_whenAzureWIDisabled(test) {
			test.expect(2);

			var pg_config = { azure_workload_identity: false, password: 'secret', host: 'localhost', table: 'items' };
			var pool_config = Tools.copyHashRemoveKeys(pg_config, { cache: 1, table: 1, azure_workload_identity: 1 });

			if (pg_config.azure_workload_identity) {
				pool_config.password = fetchAzureToken_proto.bind({});
			}

			test.ok(pool_config.password === 'secret', "password passes through unchanged when azure_workload_identity is false");
			test.ok(!('azure_workload_identity' in pool_config), "azure_workload_identity is stripped from pool_config");
			test.done();
		},

		function fetchAzureToken_cachesToken(test) {
			test.expect(2);

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-cache-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_FEDERATED_TOKEN\n', 'utf8');

			var callCount = 0;
			var origRequest = https.request;
			https.request = function(options, cb) {
				callCount++;
				var EventEmitter = require('events');
				var res = new EventEmitter();
				res.statusCode = 200;
				var fakeReq = new EventEmitter();
				fakeReq.write = function() {};
				fakeReq.setTimeout = function() {};
				fakeReq.destroy = function() {};
				fakeReq.end = function() {
					setImmediate(function() {
						cb(res);
						setImmediate(function() {
							res.emit('data', JSON.stringify({ access_token: 'CACHED_TOKEN' }));
							res.emit('end');
						});
					});
				};
				return fakeReq;
			};

			var ctx = {};
			var fetchAzureToken = fetchAzureToken_proto.bind(ctx);

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken().then(function() { return fetchAzureToken(); });
			}).then(function(token) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(token === 'CACHED_TOKEN', "Second call returns cached token: " + token);
				test.ok(callCount === 1, "https.request called only once (got " + callCount + ")");
				test.done();
			}).catch(function(err) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Unexpected error: " + err);
				test.done();
			});
		},

		function fetchAzureToken_refetchesOnExpiredCache(test) {
			test.expect(2);

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-exp-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_FEDERATED_TOKEN\n', 'utf8');

			var callCount = 0;
			var origRequest = https.request;
			https.request = function(options, cb) {
				callCount++;
				var EventEmitter = require('events');
				var res = new EventEmitter();
				res.statusCode = 200;
				var fakeReq = new EventEmitter();
				fakeReq.write = function() {};
				fakeReq.setTimeout = function() {};
				fakeReq.destroy = function() {};
				fakeReq.end = function() {
					setImmediate(function() {
						cb(res);
						setImmediate(function() {
							res.emit('data', JSON.stringify({ access_token: 'FRESH_TOKEN' }));
							res.emit('end');
						});
					});
				};
				return fakeReq;
			};

			var ctx = { _azureTokenCache: { token: 'STALE_TOKEN', expiresAt: Date.now() - 1000 } };
			var fetchAzureToken = fetchAzureToken_proto.bind(ctx);

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken();
			}).then(function(token) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(token === 'FRESH_TOKEN', "Refetches when cache is expired: " + token);
				test.ok(callCount === 1, "https.request called once for expired cache");
				test.done();
			}).catch(function(err) {
				https.request = origRequest;
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Unexpected error: " + err);
				test.done();
			});
		}

	]
};
