/*
 * XXX TODO
 * server:
 *   - add "bus reset" option
 *   - figure out how to deal with iGrabber not being open:
 *     - when it's not open at all, open it in the "right" way
 *     - detect and recover from accidentally opening it in its non-functional
 *       state?
 *   - make it bulletproof w.r.t. all possible states
 */

var mod_child = require('child_process');
var mod_http = require('http');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_util = require('util');

var mod_bunyan = require('bunyan');
var mod_mkdirp = require('mkdirp');
var mod_restify = require('restify');
var mod_vasync = require('vasync');

/*
 * Configuration
 */
var base = mod_path.join(process.env['HOME'], 'Desktop/Kart/data');
var tmpdir = mod_path.join(base, 'incoming');
var finaldir = mod_path.join(base, 'upload');
var rawdir = mod_path.join(base, 'raw');
var port = 8313;
var ulogevents = [];

/*
 * Global state
 */
var startTime = new Date();
var locked = false;
var bounds = 0;
var statepending = [];
var dflHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json'
};
var currentFile, log, server;

function main()
{
	process.chdir(__dirname);

	log = new mod_bunyan({
	    'name': 'kartctl',
	    'level': process.env['LOG_LEVEL'] || 'debug'
	});

	log.info('server starting');
	log.debug('creating directory "%s"', tmpdir);
	mod_mkdirp.sync(tmpdir);
	log.debug('creating directory "%s"', finaldir);
	mod_mkdirp.sync(finaldir);
	log.debug('creating directory "%s"', rawdir);
	mod_mkdirp.sync(rawdir);

	server = mod_restify.createServer();

	server.opts('/start', cmnHeaders, cors);
	server.opts('/stop', cmnHeaders, cors);
	server.opts('/state', cmnHeaders, cors);
	server.get('/state', cmnHeaders, getState, state);
	server.get('/', cmnHeaders, function (req, res, next) {
		res.header('Location', '/www/index.htm');
		res.send(302);
	});
	server.get('/www/:file', cmnHeaders, getFile);
	server.post('/stop', cmnHeaders, lock, getState, stop, getState, state);
	server.post('/start', mod_restify.bodyParser({ 'mapParams': false }),
	    cmnHeaders, lock, getState, start, getState, state);
	server.on('after', unlock);
	server.on('after', function (req, res) {
		log.debug({
		    'method': req.method,
		    'url': req.url,
		    'statusCode': res.statusCode
		}, 'done request');
	});
	server.listen(port, '127.0.0.1', function () {
		log.info('server listening on port', port);
		ulog('Backend ready.');
	});
	server.on('uncaughtException',
	    function (_1, _2, _3, err) { throw (err); });
}

function cmnHeaders(req, res, next)
{
	log.debug({
	    'method': req.method,
	    'url': req.url
	}, 'incoming request');
	for (var h in dflHeaders)
		res.header(h, dflHeaders[h]);
	next();
}

function getFile(req, res, next)
{
	var file = req.params['file'];
	if (!/^[^.][a-zA-Z0-9\.-]+$/.test(file)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	var stream = mod_fs.createReadStream(mod_path.join('www', file));
	stream.on('error', function (err) {
		if (err['code'] != 'ENOENT')
			next(err);
		else
			next(new mod_restify.ResourceNotFoundError());
	});
	stream.on('open', function () {
		if (/\.htm$/.test(file))
			res.header('content-type', 'text/html');
		res.writeHead(200);
		stream.pipe(res);
	});
}

function cors(req, res, next)
{
	res.send(200, { 'ok': true });
	next();
}

function getState(req, res, next)
{
	var onstate = function (err, newstate) {
		req.igState = newstate;
		if (!err && (newstate == 'stuck' || newstate == 'not ready'))
			err = new Error('bad state: ' + newstate);
		next(err);
	};

	statepending.push(onstate);
	if (statepending.length == 1)
		doFetchState();
}

function state(req, res, next)
{
	res.send(200, { 'state': req.igState, 'ulog': ulogevents });
	next();
}

function lock(req, res, next)
{
	if (locked) {
		next(new Error('operation already pending'));
		return;
	}

	locked = true;
	req.locked = true;
	next();
}

function unlock(req, res, next)
{
	if (req.locked) {
		req.locked = false;
		locked = false;
	}
}

function start(req, res, next)
{
	if (req.igState == 'idle') {
		doStart(req, res, next);
		return;
	}

	stop(req, res, function (err) {
		if (err) {
			next(err);
			return;
		}

		doStart(req, res, next);
	});
}

function doStart(req, res, next)
{
	var filebase = 'video-' + startTime.getTime() + '-' +
	    (bounds++) + '.mov';
	var filename = mod_path.join(tmpdir, filebase);
	var jsonfilename = mod_path.join(finaldir, filebase + '.json');
	var rawjsonfilename = mod_path.join(rawdir, filebase + '.raw.json');
	var translated = prepareJson(filebase, req.body);

	log.info('starting recording', filename);
	mod_fs.writeFileSync(rawjsonfilename, JSON.stringify(req.body));
	mod_fs.writeFileSync(jsonfilename, JSON.stringify(translated));
	doCmd('./bin/start_recording ' + filename, function (err) {
		if (err) {
			next(err);
			return;
		}

		ulog('Started recording race.');
		currentFile = filebase;
		next();
	});
}

function prepareJson(filebase, input)
{
	var id, i, time, players;

	/*
	 * This is the same algorithm node-formidable uses, which is how ids
	 * were constructed for the first year's worth of kartlytics videos.
	 */
	id = '';
	for (i = 0; i < 32; i++)
		id += Math.floor(Math.random() * 16).toString(16);

	/*
	 * XXX We should really get crtime from the video file metadata.
	 */
	time = new Date();
	players = [
	    input['p1handle'] || 'anon',
	    input['p2handle'] || 'anon',
	    input['p3handle'] || 'anon'
	];

	if (input['nplayers'] == 4)
		players.push(input['p4handle'] || 'anon');

	return ({
	    'id': id,
	    'crtime': time.getTime(),
	    'name': filebase,
	    'uploaded': time.toISOString(),
	    'lastUpdated': time.toISOString(),
	    'metadata': {
		'races': [ {
		    'level': input['level'] || 'unknown',
		    'people': players
		} ]
	    }
	});
}

function stop(req, res, next)
{
	var orig, fin;

	if (req.igState != 'recording') {
		next();
		return;
	}

	orig = mod_path.join(tmpdir, currentFile);
	fin = mod_path.join(finaldir, currentFile);

	log.info('stopping recording', filename);
	mod_vasync.pipeline({
	    'funcs': [
		function (_, callback) {
			doCmd('./bin/stop_recording', callback);
		},
		function (_, callback) {
			callback();
			ulog('Stopped recording race.');
			if (currentFile === undefined)
				return;

			currentFile = undefined;
			log.debug('compressing final video');
			mod_child.exec('./bin/save_video "' +
			    orig + '" "' + fin + '"',
			    function (err, stdout, stderr) {
				if (err)
					log.error(err, 'save_video failed ' +
					    '(stdout = "%s", stderr = "%s")',
					    stdout, stderr);
				else
					log.info('video successfully processed',
					    mod_path.basename(fin));
			    });
		}
	    ]
	}, next);
}

function doCmd(program, callback)
{
	log.debug('running program ', JSON.stringify(program));
	mod_child.exec(program, function (error, stdout, stderr) {
		if (error) {
			var str = 'command failed: ' +
			    (error.code ? 'code ' + error.code :
			    'signal ' + error.signal) + '\n' +
			    'stdout=' + stdout + '; stderr=' + stderr;
			var err = new Error(str);
			log.error(err);
			callback(err);
			return;
		}

		log.debug('"%s" completed okay', program);
		callback(null, stdout);
	});
}

function doFetchState()
{
	var ondone = function (err, newstate) {
		if (!err)
			log.debug('current state =', newstate);
		var st = statepending;
		statepending = [];
		st.forEach(function (s) { s(err, newstate); });
	};

	doCmd('./bin/get_state', function (err, stdout) {
		if (err) {
			ondone(err);
			return;
		}

		if (/A movie is being recorded./.test(stdout)) {
			ondone(null, 'recording');
			return;
		}

		if (/Your movie has been recorded./.test(stdout)) {
			ondone(null, 'stuck');
			return;
		}

		if (!/iGrabber Capture/.test(stdout)) {
			ondone(null, 'not ready');
			return;
		}

		ondone(null, 'idle');
	});
}


function ulog()
{
	var args = Array.prototype.slice.call(arguments);
	var msg = mod_util.format.apply(null, args);
	ulogevents.unshift([ Date.now(), msg ]);
	ulogevents = ulogevents.slice(0, 10);
}

main();
