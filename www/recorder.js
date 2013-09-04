var url = 'http://localhost:8313';

var kTickInterval = 5000;
var kEmailRequired = false;

window.onload = kRefreshState;

var stateErrorDetails = {
    'not ready': 'It looks like the "iGrabber Capture" application is not ' +
	'running.  Launch it from Applications > iGrabber Capture.  (If it ' +
	'is already running, try force quitting it and then launching it.)',
    'stuck': 'The "iGrabber Capture" application is stuck.  Try switching ' +
	'to it and clicking the "OK" button.'
};

function kRefreshState()
{
	makeRequest('get', '/state', null, function () {
		setTimeout(kRefreshState, kTickInterval);
	});
}

function kLoadState(data)
{
	$('#kStatus').text(data);

	if (stateErrorDetails.hasOwnProperty(data)) {
		$('.kError').css('display', 'block');
		$('.kError').text(stateErrorDetails[data]);
	} else {
		$('.kError').css('display', 'none');
	}

	if (data == 'recording') {
		$('#kButtonStart').prop('value',
		    'Start recording another race');
		$('#kButtonStart').prop('disabled', false);
		$('#kButtonStop').prop('disabled', false);
	} else if (data == 'idle') {
		$('#kButtonStart').prop('disabled', false);
		$('#kButtonStop').prop('disabled', 'true');
	} else {
		$('#kButtonStart').prop('disabled', true);
		$('#kButtonStop').prop('disabled', true);
	}
}

function kLoadLog(elts)
{
	var html =
	    '<table class="kLog">' +
	    elts.map(function (entry) {
		return ('<tr><td class="kLogWhen">' +
		    new Date(entry[0]).toLocaleTimeString() +
		    '</td><td class="kLogMessage">' + entry[1] + '</td></tr>');
	    }).join('\n') + '</table>';
	$('#kLog').html(html);
}

function kReset()
{
	$('input[type=text]').val('');
}

function kStop()
{
	makeRequest('post', '/stop', {});
}

function kStart()
{
	var obj, npl, msg;

	obj = {};
	$('input[type=text]').each(
	    function (_, e) { obj[e.id] = $(e).val(); });

	npl = $('#np3')[0].checked ? 3 : 4;
	obj['nplayers'] = npl;

	obj['level'] =
	    $('#50cc')[0].checked ? '50cc' :
	    $('#100cc')[0].checked ? '100cc' :
	    $('#150cc')[0].checked ? '150cc' : 'unknown';

	if (!obj['p1handle'] || !obj['p2handle'] || !obj['p3handle'] ||
	    (npl == 4 && !obj['p4handle']))
		msg = 'Handles are required.  (Use "anon" for anonymous.)';
	else if (kEmailRequired &&
	    (!obj['p1email'] || !obj['p2email'] || !obj['p3email'] ||
	    (npl == 4 && !obj['p4email'])))
		msg = 'Email address is required.';

	if (msg) {
		alert(msg);
		return;
	}

	makeRequest('post', '/start', obj);
}

function makeRequest(method, path, args, callback)
{
	var options = {
	    'url': url + path,
	    'method': method,
	    'dataType': 'json',
	    'success': function (data) {
		kLoadState(data['state']);
		kLoadLog(data['ulog']);
		if (callback)
			callback();
	    },
	    'error': function (data) {
		var msg;
		try { msg = JSON.parse(data['responseText']); } catch (ex) {}
		if (msg && msg['message'].substr(0, 'bad state: '.length) ==
		    'bad state: ')
			kLoadState(msg['message'].substr('bad state: '.length));
		else
			console.error('failed request: ', path, data);

		if (callback)
			callback(new Error('failed'));
	    }
	};

	if (args) {
		options['contentType'] = 'application/json';
		options['data'] = JSON.stringify(args);
		options['processData'] = false;
	}

	$.ajax(options);
}

function kNpChanged()
{
	if ($('#np3')[0].checked) {
		$('#p4handle, #p4email').prop('disabled', true);
		$('#p4handle, #p4email').val('');
	} else {
		$('#p4handle, #p4email').prop('disabled', false);
	}
}
