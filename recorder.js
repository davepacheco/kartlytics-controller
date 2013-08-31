var url = 'http://localhost:8313';

var tickInterval = 5000;

window.onload = kRefreshState;

function kRefreshState()
{
	makeRequest('get', '/state', null, function (err, data) {
		if (!err)
			$('#kStatus').text(data);
		setTimeout(kRefreshState, tickInterval);
	});
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
	var obj = {};
	$('input[type=text]').each(
	    function (_, e) { obj[e.id] = $(e).val(); });
	makeRequest('post', '/start', obj);
}

function makeRequest(method, path, args, callback)
{
	var options = {
	    'url': url + path,
	    'method': method,
	    'dataType': 'json',
	    'success': function (data) {
		if (callback)
			callback(null, data);
	    },
	    'error': function (data) {
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
