var DEBUG = false

exports.paddr = function paddr(lo, hi) {
  if(arguments.length == 1) {
    hi = lo[1];
    lo = lo[0];
  }
  var slo = ('00000000' + lo.toString(16)).slice(-8);
  var shi = ('00000000' + hi.toString(16)).slice(-8);
  return '0x' + shi + slo;
}

exports.parseAddr = function parseAddr(addr) {
  var arr = addr.replace('0x', '').match(/.{8}/g)
  var hi = parseInt(arr[0], 16)
  var lo = parseInt(arr[1], 16)
  return [ lo, hi ]
}

exports.nullptr = function nullptr(addr) {
  return addr[0] == 0 && addr[1] == 0;
}

exports.eq = function eq(a, b) {
  return a[0] == b[0] && a[1] == b[1];
}

exports.add2 = function add2(addr, off) {
  if(typeof(off) == 'number')
    off = [off, 0];

  var alo = addr[0], ahi = addr[1];
  var blo = off[0], bhi = off[1];

  var nlo = ((alo + blo) & 0xFFFFFFFF) >>> 0;
  var nhi = ((ahi + bhi) & 0xFFFFFFFF) >>> 0;

  if((nlo < alo && blo > 0) || (nlo == alo && blo != 0)) {
    nhi = ((nhi + 1) & 0xFFFFFFFF) >>> 0;
  } else if(nlo > alo && blo < 0) {
    nhi = ((nhi - 1) & 0xFFFFFFFF) >>> 0;
  }

  return [nlo, nhi];
}

exports.send = function send(ep, data) {
  var msg = {
    msg: data
  }
  var jsonstr = JSON.stringify(msg);
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/' + ep, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(jsonstr);
  } catch(e) {

  }
}

exports.dlog = function dlog(msg) {
  if(DEBUG) {
    log(msg)
  }
}

console = {
  log: function(msg) {
    exports.send('log', msg);
  }
}

var log = console.log

exports.log = log
