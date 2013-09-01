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
 *   - add logic to detect and get out of "stuck" state
 *   - make it bulletproof w.r.t. all possible states
 *   - format JSON the way kartlytics expects
 *   - add move-to-upload-directory and trigger upload (at most once)
 */

var mod_child = require('child_process');
var mod_http = require('http');
var mod_fs = require('fs');
var mod_util = require('util');

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');

var log = new mod_bunyan({
    'name': 'kartctl',
    'level': process.env['LOG_LEVEL'] || 'debug'
});
var port = 8313;
var locked = false;
var filebase = '/Users/dap/Desktop/KartPending/video-';
var bounds = 0;
var dflHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json'
};
var statepending = [];
var server;

function main()
{
	process.chdir(__dirname);

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
	    function (_, _, _, err) { throw (err); });
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
	var onstate = function (err, state) {
		req.igState = state;
		if (!err && state == 'stuck')
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
	var filename = filebase + process.pid + '-' + (bounds++) + '.mov';
	mod_fs.writeFileSync(filename + '.json', JSON.stringify(req.body));
	doCmd(log, './start_recording ' + filename, function (err) {
		if (err) {
			next(err);
			return;
		}

		next();
	});
}

function stop(req, res, next)
{
	if (req.igState != 'recording') {
		next();
		return;
	}

	doCmd(log, './stop_recording', function (err) {
		if (err) {
			next(err);
			return;
		}

		next();
	});
}

function doCmd(log, program, callback)
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
	var ondone = function (err, state) {
		if (!err)
			log.debug('current state =', state);
		var st = statepending;
		statepending = [];
		st.forEach(function (s) { s(err, state); });
	};

	doCmd(log, './get_state', function (err, stdout) {
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
