var url = 'http://localhost:8313';

function kReset()
{
	$('input[type=text]').val('');
}

function kStop()
{
	makeRequest('/stop', {});
}

function kStart()
{
	var obj = {};
	$('input[type=text]').each(
	    function (_, e) { obj[e.id] = $(e).val(); });
	makeRequest('/start', obj);
}

function makeRequest(path, args)
{
	$.ajax({
	    'url': url + path,
	    'method': 'post',
	    'contentType': 'application/json',
	    'data': JSON.stringify(args),
	    'processData': false,
	    'dataType': 'json',
	    'success': function () {},
	    'error': function (data) {
		console.log(data);
	    	alert('error: ' + data);
	    }
	})
}
