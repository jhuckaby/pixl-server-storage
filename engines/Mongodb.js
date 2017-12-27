// Mongodb Storage Plugin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

// Requires the 'mongodb' module from npm
// npm install mongodb

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var MongodbAPI = require('monk'); // 5.0.2 / 2017-05-22

module.exports = Class.create({

    __name: 'Mongodb',
    __parent: Component,

    // https://github.com/mafintosh/mongojs
    // https://docs.mongodb.com/manual/reference/connection-string/
    // mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
    defaultConfig: {
        connectString: "mongodb://127.0.0.1/cronicle",
        collection: "data",
        serialize: true
    },

    startup: function (callback) {
        // setup Mongodb connection
        var self = this;
        this.logDebug(2, "Setting up Mongodb");

        this.setup(callback);
        this.config.on('reload', function () {
            self.setup();
        });
    },

    setup: function (callback) {
        // setup Mongodb connection
        var self = this;
        var connectionString = this.config.get('connectString') || this.config.get('connect_string');
        var collection = this.config.get('collection');

        // support old legacy naming convention: connect_string
        self.cluster = MongodbAPI(connectionString);
        self.collection = self.cluster.get(collection);
        self.collection.createIndex({key: 1}, function (err, result) {
            if (callback) callback(err);
        });
    },

    put: function (key, value, callback) {
        // store key+value in Mongodb
        var self = this;

        if (this.storage.isBinaryKey(key)) {
            value = new Buffer(value).toString('base64');
            this.logDebug(9, "Storing Mongodb Binary Object: " + key, '' + value.length + ' bytes');
        }
        else {
            this.logDebug(9, "Storing Mongodb JSON Object: " + key, this.debugLevel(10) ? value : null);
            if (this.config.get('serialize')) value = JSON.stringify(value);
        }

        try {
            this.collection.findOneAndUpdate(
                {"key": key},
                {$set: {"key": key, "value": value}},
                {upsert: true, returnNewDocument: true},
                function () {
                    self.logDebug(9, "Store complete: " + key);
                    if (callback) callback(null);
                });


        } catch (err) {
            err.message = "Failed to store object: " + key + ": " + err.message;
            self.logError('mongodb', err.message);
            if (callback) callback(err);
        }
    },

    putStream: function (key, inp, callback) {
        // store key+value in Mongodb using read stream
        var self = this;

        // The Mongodb Node.JS 2.0 API has no stream support.
        // So, we have to do this the RAM-hard way...

        var chunks = [];
        inp.on('data', function (chunk) {
            chunks.push(chunk);
        });
        inp.on('end', function () {
            var buf = Buffer.concat(chunks);
            self.put(key, buf, callback);
        });
    },

    head: function (key, callback) {
        // head mongodb value given key
        var self = this;

        this.get(key, function (err, data) {
            if (err) {
                // some other error
                err.message = "Failed to head key: " + key + ": " + err.message;
                self.logError('mongodb', err.message);
                callback(err);
            }
            else if (!data) {
                // record not found
                // always use "NoSuchKey" in error code
                var err = new Error("Failed to head key: " + key + ": Not found");
                err.code = "NoSuchKey";

                callback(err, null);
            }
            else {
                if (typeof data === "object") {
                    data = JSON.stringify(data);
                }
                callback(null, {mod: 1, len: data.length});
            }
        });
    },

    get: function (key, callback) {
        // fetch Mongodb value given key
        var self = this;

        this.logDebug(9, "Fetching Mongodb Object: " + key);

        this.collection.findOne({"key": key}, function (err, result) {
            if (!result) {
                err = new Error("Failed to fetch key: " + key + ": Not found");
                err.code = "NoSuchKey";

                callback(err, null);
            }
            else {
                var body = result.value;

                if (self.storage.isBinaryKey(key)) {
                    body = new Buffer(body, 'base64');
                    self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
                }
                else {
                    if (self.config.get('serialize')) {
                        try {
                            body = JSON.parse(body.toString());
                        }
                        catch (e) {
                            self.logError('mongodb', "Failed to parse JSON record: " + key + ": " + e);
                            callback(e, null);
                            return;
                        }
                    }
                    self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? body : null);
                }

                if (callback) callback(null, body);
            }
        });
    },

    getStream: function (key, callback) {
        // get readable stream to record value given key
        var self = this;

        this.get(key, function (err, buf) {
            if (err) {
                // some other error
                err.message = "Failed to fetch key: " + key + ": " + err.message;
                self.logError('mongodb', err.message);
                return callback(err);
            }
            else if (!buf) {
                // record not found
                var err = new Error("Failed to fetch key: " + key + ": Not found");
                err.code = "NoSuchKey";
                return callback(err, null);
            }

            var stream = new BufferStream(buf);
            callback(null, stream);
        });
    },

    delete: function (key, callback) {
        // delete Mongodb key given key
        // Example CB error message: The key does not exist on the server
        var self = this;

        this.logDebug(9, "Deleting Mongodb Object: " + key);

        this.collection.remove({"key": key}, function (err, r) {

            if (r.result.n == 0) {
                err = err || {};
                err.code = "NoSuchKey";
                err.message = "Failed to delete key: " + key + ": Not found";
                self.logError('mongodb', err.message);
            } else {
                self.logDebug(9, "Delete complete: " + key);
            }
            if (callback) callback();
        });
    },

    runMaintenance: function (callback) {
        // run daily maintenance
        this.collection.remove({"key": /^_cleanup\/.*/i});
        if (callback) callback();
    },

    shutdown: function (callback) {
        // shutdown storage
        this.logDebug(2, "Shutting down Mongodb");
        this.cluster.close();
        if (callback) callback();
    }

});

// Modified the following snippet from node-streamifier:
// Copyright (c) 2014 Gabriel Llamas, MIT Licensed

var util = require('util');
var stream = require('stream');

var BufferStream = function (object, options) {
    if (object instanceof Buffer || typeof object === 'string') {
        options = options || {};
        stream.Readable.call(this, {
            highWaterMark: options.highWaterMark,
            encoding: options.encoding
        });
    } else {
        stream.Readable.call(this, {objectMode: true});
    }
    this._object = object;
};

util.inherits(BufferStream, stream.Readable);

BufferStream.prototype._read = function () {
    this.push(this._object);
    this._object = null;
};
