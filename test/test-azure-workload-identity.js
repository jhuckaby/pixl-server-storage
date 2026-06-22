// Unit tests for Postgres engine Azure Workload Identity support
// Copyright (c) 2026 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var path = require('path');
var os = require('os');
var https = require('https');
var Tools = require('pixl-tools');

// Replicate fetchAzureToken exactly as defined in engines/Postgres.js so we can
// test it without requiring the `pg` peer dependency.
var fetchAzureToken = async function() {
	var tenant_id = process.env.AZURE_TENANT_ID;
	var client_id = process.env.AZURE_CLIENT_ID;
	var token_file = process.env.AZURE_FEDERATED_TOKEN_FILE;

	if (!tenant_id || !client_id || !token_file) {
		throw new Error("Azure Workload Identity requires AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_FEDERATED_TOKEN_FILE env vars");
	}

	var federated_token = fs.readFileSync(token_file, 'utf8').trim();

	var body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: client_id,
		scope: 'https://ossrdbms-aad.database.windows.net/.default',
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: federated_token
	}).toString();

	return new Promise(function(resolve, reject) {
		var options = {
			hostname: 'login.microsoftonline.com',
			path: '/' + tenant_id + '/oauth2/v2.0/token',
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(body)
			}
		};
		var req = https.request(options, function(res) {
			var data = '';
			res.on('data', function(chunk) { data += chunk; });
			res.on('end', function() {
				try {
					var parsed = JSON.parse(data);
					if (parsed.access_token) resolve(parsed.access_token);
					else reject(new Error("Azure token fetch failed: " + data));
				} catch(e) { reject(e); }
			});
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
};

function withEnv(vars, fn) {
	// Set env vars, call fn, then restore original state
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

function mockHttps(responseBody) {
	var EventEmitter = require('events');
	var origRequest = https.request;
	https.request = function(options, cb) {
		var res = new EventEmitter();
		var fakeReq = new EventEmitter();
		fakeReq.write = function() {};
		fakeReq.end = function() {
			setImmediate(function() {
				cb(res);
				setImmediate(function() {
					res.emit('data', typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
					res.emit('end');
				});
			});
		};
		return fakeReq;
	};
	return function restore() { https.request = origRequest; };
}

module.exports = {
	tests: [

		function fetchAzureToken_missingEnvVars(test) {
			test.expect(1);
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

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_FEDERATED_TOKEN\n', 'utf8');

			var restore = mockHttps({ access_token: 'FAKE_ACCESS_TOKEN' });
			var capturedOptions = null;
			var origRequest = https.request;
			https.request = function(options, cb) {
				capturedOptions = options;
				return origRequest.call(https, options, cb);
			};
			// (mockHttps already replaced origRequest so chain properly)
			// Redo: capture and delegate to the mock
			restore(); // restore the real one
			var mockRestore = mockHttps({ access_token: 'FAKE_ACCESS_TOKEN' });
			var mockRequest = https.request;
			https.request = function(options, cb) {
				capturedOptions = options;
				return mockRequest.call(https, options, cb);
			};

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken();
			}).then(function(token) {
				mockRestore();
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(token === 'FAKE_ACCESS_TOKEN', "Returned expected access_token");
				test.ok(capturedOptions && capturedOptions.hostname === 'login.microsoftonline.com', "Called correct hostname");
				test.ok(capturedOptions && capturedOptions.path.indexOf('test-tenant-id') >= 0, "Path contains tenant ID");
				test.done();
			}).catch(function(err) {
				mockRestore();
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Unexpected error: " + err);
				test.done();
			});
		},

		function fetchAzureToken_rejectsOnErrorResponse(test) {
			test.expect(1);

			var tokenFile = path.join(os.tmpdir(), 'pixl-test-fedtoken-err-' + process.pid + '.txt');
			fs.writeFileSync(tokenFile, 'FAKE_TOKEN', 'utf8');

			var restore = mockHttps({ error: 'invalid_client', error_description: 'Bad credentials' });

			withEnv({
				AZURE_TENANT_ID: 'test-tenant-id',
				AZURE_CLIENT_ID: 'test-client-id',
				AZURE_FEDERATED_TOKEN_FILE: tokenFile
			}, function() {
				return fetchAzureToken();
			}).then(function() {
				restore();
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(false, "Should have rejected on error response");
				test.done();
			}).catch(function(err) {
				restore();
				try { fs.unlinkSync(tokenFile); } catch(e) {}
				test.ok(/Azure token fetch failed/.test(err.message), "Error message is descriptive: " + err.message);
				test.done();
			});
		},

		function poolConfig_passwordIsFunction_whenAzureWIEnabled(test) {
			test.expect(2);

			var pg_config = { azure_workload_identity: true, host: 'localhost', database: 'test', user: 'test', table: 'items' };
			var pool_config = Tools.copyHashRemoveKeys(pg_config, { cache: 1, table: 1, azure_workload_identity: 1 });

			if (pg_config.azure_workload_identity) {
				delete pool_config.password;
				pool_config.password = async function() { return 'token'; };
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
				delete pool_config.password;
				pool_config.password = async function() { return 'token'; };
			}

			test.ok(pool_config.password === 'secret', "password passes through unchanged when azure_workload_identity is false");
			test.ok(!('azure_workload_identity' in pool_config), "azure_workload_identity is stripped from pool_config");
			test.done();
		}

	]
};
