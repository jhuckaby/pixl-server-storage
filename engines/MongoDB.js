// MongoDB Storage Plugin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

// Requires the 'mongodb' module from npm
// npm install mongodb@3

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var MongoClient = require('mongodb').MongoClient; // mongodb@3.0.1
var GridFSBucket = require('mongodb').GridFSBucket;

module.exports = Class.create({

    __name: 'MongoDB',
    __parent: Component,

    // https://github.com/mafintosh/mongojs
    // https://docs.mongoDB.com/manual/reference/connection-string/
    // mongoDB://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
    defaultConfig: {
        connectString: "mongodb://127.0.0.1",
        databaseName: "cronicle",
        collectionName: "data_test",
        gridFsBucketName: null,
        bucketChunkSizeMb: 0.5,
        serialize: true
    },

    startup: function (callback) {
        // setup MongoDB connection
        var self = this;
        this.logDebug(2, "Setting up MongoDB");

        this.setup(callback);
        this.config.on('reload', function () {
            self.setup();
        });
    },

    setup: function (callback) {
        // setup MongoDB connection
        var self = this;
        var connectionString = this.config.get('connectString') || this.config.get('connect_string');
        var databaseName = this.config.get('databaseName');
        var collectionName = this.config.get('collectionName');

        var gridFsBucketName = this.config.get('gridFsBucketName');
        var bucketChunkSizeMb = this.config.get('bucketChunkSizeMb') || 1;
        var bucketChunkSizeBytes = bucketChunkSizeMb * 1048576;
        if (!gridFsBucketName) {
            gridFsBucketName = databaseName + '_bucket';
        }

        // Connect to the db
        MongoClient.connect(connectionString, function (err, client) {
            if (err) {
                err.message = "Failed to connect to MongoDB " + connectionString;
                self.logError("mongoDB setup", err.message);

                callback(err);
            }

            self.cluster = client;
            self.db = client.db(databaseName);

            self.gridBucket = new GridFSBucket(self.db, {bucketName: gridFsBucketName, chunkSizeBytes: bucketChunkSizeBytes});
            self.logDebug(9, "mongoDB setup", "Created GridFSBucket: " + gridFsBucketName + 'Size ' + bucketChunkSizeMb + 'MB - ' + bucketChunkSizeBytes + 'bytes');

            // todo check callback
            self.collection = self.db.collection(collectionName, function (err, collection) {
                if (err) {
                    err.message = "Failed to get collection " + collectionName;
                    self.logError("mongoDB setup", err.message);

                    callback(err);
                }
                self.collection = collection;
                callback();
            });


            self.collection.createIndex({key: 1}, {background: 1}, function (err, result) {
                if (err) {
                    // non fatal error if index is not created.
                    err.message = "Failed to create index key";
                    self.logError("mongoDB setup", err.message);
                } else {
                    self.logDebug(9, "MongoDB setup", "index key created");
                }
            });

        });
    },

    put: function (key, value, callback) {
        // store key+value in MongoDB
        var self = this;

        if (this.storage.isBinaryKey(key)) {
            this.logDebug(9, "Storing MongoDB Binary Object: " + key, '' + value.length + ' bytes');
        }
        else {
            this.logDebug(9, "Storing MongoDB JSON Object: " + key, this.debugLevel(10) ? value : null);
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
            self.logError('mongoDB', err.message);
            if (callback) callback(err);
        }
    },

    putStream: function (key, inp, callback) {
        // store key+value in MongoDB using upload stream
        var self = this;

        var uploadStream = self.gridBucket.openUploadStream(key);

        inp.on('data', function (chunk) {
            uploadStream.write(chunk, 'utf8');
        });
        inp.on('end', function (chunk) {
            uploadStream.end(chunk, 'utf8', callback);
        });
    },

    head: function (key, callback) {
        // head mongoDB value given key
        var self = this;

        this.get(key, function (err, data) {
            if (err) {
                // some other error
                err.message = "Failed to head key: " + key + ": " + err.message;
                self.logError('mongoDB', err.message);
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
        // fetch MongoDB value given key
        var self = this;

        this.logDebug(9, "Fetching MongoDB Object: " + key);

        self.collection.findOne({"key": key}, function (err, result) {
            if (!result) {
                err = new Error("Failed to fetch key: " + key + ": Not found");
                err.code = "NoSuchKey";

                callback(err, null);
            }
            else {
                var body = result.value;

                if (self.storage.isBinaryKey(key)) {
                    body = body.buffer;
                    self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
                }
                else {
                    if (self.config.get('serialize')) {
                        try {
                            body = JSON.parse(body.toString());
                        }
                        catch (e) {
                            self.logError('mongoDB', "Failed to parse JSON record: " + key + ": " + e);
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

        var downloadStream = self.gridBucket.openDownloadStreamByName(key);

        downloadStream.on('error', function (err) {
            self.logError('MongoDB', "Failed to fetch key: " + key + ": " + err);
            callback(err);
            return;

        });
        //
        downloadStream.on('end', function () {
            self.logDebug(9, "MongoDB stream download complete: " + key);
        });

        downloadStream.start(0);
        callback(null, downloadStream);
    },

    delete: function (key, callback) {
        // delete MongoDB key given key
        // Example CB error message: The key does not exist on the server
        var self = this;

        this.logDebug(9, "Deleting MongoDB Object: " + key);

        this.collection.remove({"key": key}, function (err, r) {

            if (r.result.n == 0) {
                err = err || {};
                err.code = "NoSuchKey";
                err.message = "Failed to delete key: " + key + ": Not found";
                self.logError('mongoDB', err.message);
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
        this.logDebug(2, "Shutting down MongoDB");
        this.cluster.close();
        if (callback) callback();
    }

});
