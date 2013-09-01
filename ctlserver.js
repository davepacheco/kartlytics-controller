/*
 * XXX TODO
 * web page:
 *   - add option for CC level
 *   - add option for # of players?
 *   - add option to make email required
 *   - add better feedback around current state and allowable button clicks
 *   - improve styling of the buttons
 *   - provide error feedback
 * server:
 *   - remaining states that are hard to detect or get out of:
 *     - "stuck" state resulting from two "stops"
 *     - iGrabber not open at all (start/stop opens it in a non-functional
 *       state)
 *   - make it bulletproof w.r.t. all possible states
 *   - trigger upload (at most once)
 *   - add ability to serve index.htm and related files?
 */

var mod_child = require('child_process');
var mod_http = require('http');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_util = require('util');

var mod_bunyan = require('bunyan');
var mod_mkdirp = require('mkdirp');
var mod_restify = require('restify');

/*
 * Configuration
 */
var base = mod_path.join(process.env['HOME'], 'Desktop/KartPending');
var tmpdir = mod_path.join(base, 'incoming');
var finaldir = mod_path.join(base, 'upload');
var port = 8313;

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

	server = mod_restify.createServer();

	server.opts('/start', cmnHeaders, cors);
	server.opts('/stop', cmnHeaders, cors);
	server.opts('/state', cmnHeaders, cors);
	server.get('/state', cmnHeaders, getState, state);
	server.post('/stop', cmnHeaders, lock, getState, stop, getState, state);
	server.post('/start', mod_restify.bodyParser({ 'mapParams': false }),
	    cmnHeaders, lock, getState, start, getState, state);
	server.on('after', unlock);
	server.on('after', function (req, res) {
		log.info({
		    'method': req.method,
		    'url': req.url,
		    'statusCode': res.statusCode
		}, 'done request');
	});
	server.listen(port, '127.0.0.1', function () {
		log.info('server listening on port', port);
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

function cors(req, res, next)
{
	res.send(200, { 'ok': true });
	next();
}

function getState(req, res, next)
{
	var onstate = function (err, newstate) {
		req.igState = newstate;
		if (!err && newstate == 'stuck')
			err = new Error('state is "stuck"');
		next(err);
	};

	statepending.push(onstate);
	if (statepending.length == 1)
		doFetchState();
}

function state(req, res, next)
{
	res.send(200, req.igState);
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
	var rawjsonfilename = mod_path.join(finaldir, filebase + '.raw.json');
	var translated = prepareJson(filebase, req.body);

	mod_fs.writeFileSync(rawjsonfilename, JSON.stringify(req.body));
	mod_fs.writeFileSync(jsonfilename, JSON.stringify(translated));
	doCmd('./start_recording ' + filename, function (err) {
		if (err) {
			next(err);
			return;
		}

		currentFile = filebase;
		next();
	});
}

function prepareJson(filebase, input)
{
	var id, i, time;

	/*
	 * This is the same algorithm node-formidable uses, which is how ids
	 * were constructed for the first year's worth of kartlytics videos.
	 */
	id = '';
	for (i = 0; i < 32; i++)
		id += Math.floor(Math.random() * 16).toString(16);

	/*
	 * XXX we should really get this from the video metadata after it's
	 * created.
	 */
	time = new Date();
	return ({
	    'id': id,
	    'crtime': time.getTime(),
	    'name': filebase,
	    'uploaded': time.toISOString(),
	    'lastUpdated': time.toISOString(),
	    'metadata': {
		'races': [ {
		    'level': input['level'] || 'unknown',
		    'people': [
			input['p1handle'] || 'anon',
			input['p2handle'] || 'anon',
			input['p3handle'] || 'anon',
			input['p4handle'] || 'anon'
		    ]
		} ]
	    }
	});
}

function stop(req, res, next)
{
	if (req.igState != 'recording') {
		next();
		return;
	}

	doCmd('./stop_recording', function (err) {
		if (err) {
			next(err);
			return;
		}

		if (currentFile !== undefined) {
			var src = mod_path.join(tmpdir, currentFile);
			var dst = mod_path.join(finaldir, currentFile);
			currentFile = undefined;
			log.info('renaming "%s" to "%s"');
			/* XXX trigger at most one upload-all? */
			try {
				mod_fs.renameSync(src, dst);
			} catch (ex) {
				log.error(ex, 'error renaming "%s" to "%s"',
				    src, dst);
			}
		}

		next();
	});
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

	doCmd('./get_state', function (err, stdout) {
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

		ondone(null, 'idle');
	});
}

main();
