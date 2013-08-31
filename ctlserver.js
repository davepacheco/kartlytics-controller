#!/usr/bin/env node

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
var pending = false;
var recording = false;
var filebase = '/Users/dap/Desktop/KartPending/video-';
var bounds = 0;
var dflHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json'
};
var server;

function main()
{
	process.chdir(__dirname);

	server = mod_restify.createServer();

	server.opts('/start', cmnHeaders, cors);
	server.opts('/stop', cmnHeaders, cors);
	server.opts('/state', cmnHeaders, cors);
	server.get('/state', cmnHeaders, getState, start);
	server.post('/stop', cmnHeaders, getState, stop);
	server.post('/start', 
	    cmnHeaders,
	    mod_restify.bodyParser({ 'mapParams': false }),
	    getState, start);
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
	server.on('uncaughtException', function (_, _, _, err) {
		throw (err);
	});
}

function cmnHeaders(req, res, next)
{
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
	req.igState = {};
	next();
}

function state(req, res, next)
{
	res.send(200, req.igState);
	next();
}

function start(req, res, next)
{
	var filename = filebase + process.pid + '-' + (bounds++) + '.mov';
	mod_fs.writeFileSync(filename + '.json', JSON.stringify(req.body));
	do_cmd(log, false, './start_recording ' + filename, function (err) {
		if (err) {
			next(err);
			return;
		}

		res.send(200, { 'ok': true });
		next();
	});
}

function stop(req, res, next)
{
	do_cmd(log, true, './stop_recording', function (err) {
		if (err) {
			next(err);
			return;
		}

		res.send(200, { 'ok': true });
		next();
	});
}

function do_cmd(log, expected, program, callback)
{
	if (pending) {
		callback(new Error('operation already pending'));
		return;
	}

	if (recording && !expected) {
		callback(new Error('already recording'));
		return;
	}

	pending = true;
	log.debug('running program ', JSON.stringify(program));
	mod_child.exec(program, function (error, stdout, stderr) {
		pending = false;

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
		recording = !expected;
		callback();
	});
}

main();
