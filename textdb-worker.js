require('./utils');

var STATS = { TYPE: 'stats', reading: 0, writing: 0, usage: 0 };
var counter = 0;
var reading = 0;
var writing = 0;
var readingstats = 0;
var writingstats = 0;
var instance;
var statsid;
var lastusagedate;
var instances = {};

process.totaldbworker = 1;
process.title = 'totaldbworker';
process.on('message', processcommand);

function processcommand(msg) {

	if (!msg || !msg.builder)
		return;

	var key = msg.builder.type + '_' + msg.builder.database;
	var instance = instances[key];

	if (!instance) {
		var db = require('./textdb');
		instance = instances[key] = msg.builder.type === 'nosql' ? db.JsonDB(msg.builder.database, process.argv[2]) : db.TableDB(msg.builder.database, process.argv[2], CONF['table_' + msg.builder.database]);
		instance.recount();
		setTimeout(processcommand, 100, msg);
		return;
	}

	var callback;

	switch (msg.TYPE) {

		case 'find':
			reading++;

			instance.find().assign(msg.builder).callback(function(err, builder) {
				builder.TYPE = 'response';
				process.send(builder);
			});
			break;

		case 'find2':
			reading++;
			instance.find2().assign(msg.builder).callback(function(err, builder) {
				builder.TYPE = 'response';
				process.send(builder);
			});
			break;

		case 'insert':

			callback = function(err, builder) {
				builder.TYPE = 'response';
				process.send(builder);
			};

			if (msg.builder instanceof Array) {
				for (var i = 0; i < msg.builder.length; i++) {
					writing++;
					var b = instance.insert().assign(msg.builder[i]);
					if (i === (msg.builder.length - 1))
						b.callback(callback);
				}
			} else {
				writing++;
				instance.insert().assign(msg.builder).callback(callback);
			}

			break;

		case 'update':

			callback = function(err, builder) {
				builder.TYPE = 'response';
				process.send(builder);
			};

			if (msg.builder instanceof Array) {
				for (var i = 0; i < msg.builder.length; i++) {
					var b = instance.update().assign(msg.builder);
					if (i === (msg.builder.length - 1)) {
						writing++;
						b.callback(callback);
					}
				}
			} else {
				writing++;
				instance.update().assign(msg.builder).callback(callback);
			}

			break;

		case 'remove':

			callback = function(err, builder) {
				builder.TYPE = 'response';
				process.send(builder);
			};

			if (msg.builder instanceof Array) {
				for (var i = 0; i < msg.builder.length; i++) {
					writing++;
					var b = instance.remove().assign(msg.builder);
					if (i === (msg.builder.length - 1))
						b.callback(callback);
				}
			} else {
				writing++;
				instance.remove().assign(msg.builder).callback(callback);
			}

			break;

		case 'alter':
			instance.alter(msg.schema, err => process.send({ TYPE: 'response2', cid: msg.cid, err: err }));
			break;

		case 'clean':
			instance.clean(() => process.send({ TYPE: 'response', cid: msg.cid, success: true }));
			break;

		case 'clear':
			instance.clear(() => process.send({ TYPE: 'response', cid: msg.cid, success: true }));
			break;

		case 'drop':
			instance.drop();
			setTimeout(() => process.kill(0), 10000);
			break;
	}
}

function statresponse(err, stat) {
	if (stat) {
		STATS.size = stat.size;
		instance.inmemory = (stat.size / 1024 / 1024) <= 50;
	}
}

function measure() {

	if (counter++ > 100000000)
		counter = 0;

	var keys = Object.keys(instances);
	var pendingread = 0;
	var pendingwrite = 0;
	var duration = 0;
	var documents = 0;

	for (var i = 0; i < keys.length; i++) {
		var instance = instances[keys[i]];
		pendingread += instance.pending_reader.length + instance.pending_reader2.length + instance.pending_streamer.length;
		pendingwrite += instance.pending_update.length + instance.pending_append.length + instance.pending_remove.length;
		if (duration < instance.duration)
			duration = instance.duration;
		documents += instance.total;
	}

	STATS.pendingwrite = pendingwrite;
	STATS.pendingread = pendingread;
	STATS.duration = duration;
	STATS.documents = documents;
	STATS.memory = (process.memoryUsage().heapUsed / 1024 / 1024).floor(2);
	lastusagedate = Date.now();

	setTimeout(measure_usage_response, 50);

	if (counter % 2 === 0) {
		writingstats = Math.abs(writingstats - writing);
		readingstats = Math.abs(writingstats - reading);
		reading = 0;
		writing = 0;
	} else {
		writingstats = writing;
		readingstats = reading;
	}

	STATS.reading = readingstats;
	STATS.writing = writingstats;
	process.send(STATS);
}

setTimeout(function() {
	process.send({ TYPE: 'ready' });
	measure();
}, 100);

statsid = setInterval(measure, 10000);

process.on('exit', function() {
	clearInterval(statsid);
});

process.on('disconnect', function() {
	clearInterval(statsid);
	process.kill(0);
});

function measure_usage_response() {
	var diff = (Date.now() - lastusagedate) - 50;
	if (diff > 50)
		diff = 50;
	STATS.usage = diff <= 2 ? 0 : ((diff / 50) * 100);
}