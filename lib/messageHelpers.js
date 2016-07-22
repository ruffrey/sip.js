const parsers = require('./stringManipulation').parsers;

/* public */

function parse(s) {
  const r = s.toString('ascii').match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);
  if (r) {
    const m = parseSIPMessage(r[1]);

    if (m) {
      if (m.headers['content-length']) {
        const c = Math.max(0, Math.min(m.headers['content-length'], r[2].length));
        m.content = r[2].substring(0, c);
      } else {
        m.content = r[2];
      }

      return m;
    }
  }
}
exports.parse = parse;

function checkMessage(msg) {
  return (msg.method || (msg.status >= 100 && msg.status <= 999)) &&
    msg.headers &&
    Array.isArray(msg.headers.via) &&
    msg.headers.via.length > 0 &&
    msg.headers['call-id'] &&
    msg.headers.to &&
    msg.headers.from &&
    msg.headers.cseq;
}
exports.check = checkMessage;

/* private */

function parseGenericHeader(d, h) {
  return h
    ? `${h},${d.s}`
    : d.s;
}

const compactHeaderForm = {
  i: 'call-id',
  m: 'contact',
  e: 'contact-encoding',
  l: 'content-length',
  c: 'content-type',
  f: 'from',
  s: 'subject',
  k: 'supported',
  t: 'to',
  v: 'via'
};

function parseSIPResponse(rs, m) {
  const r = rs.match(/^SIP\/(\d+\.\d+)\s+(\d+)\s*(.*)\s*$/);

  if (r) {
    m.version = r[1];
    m.status = +r[2];
    m.reason = r[3];

    return m;
  }
}
exports.parseSIPResponse = parseSIPResponse;

function parseSIPRequest(rq, m) {
  const r = rq.match(/^([\w\-.!%*_+`'~]+)\s([^\s]+)\sSIP\s*\/\s*(\d+\.\d+)/);

  if (r) {
    m.method = unescape(r[1]);
    m.uri = r[2];
    m.version = r[3];

    return m;
  }
}
exports.parseSIPRequest = parseSIPRequest;

function parseSIPMessage(_data) {
  const m = {};
  const data = _data.split(/\r\n(?![ \t])/);

  if (data[0] === '') {
    return;
  }

  if (!(parseSIPResponse(data[0], m) || parseSIPRequest(data[0], m))) {
    return;
  }

  m.headers = {};

  for (let i = 1; i < data.length; ++i) {
    const r = data[i].match(/^([\S]*?)\s*:\s*([\s\S]*)$/);
    if (!r) {
      return;
    }

    let name = unescape(r[1]).toLowerCase();
    name = compactHeaderForm[name] || name;

    m.headers[name] = (parsers[name] || parseGenericHeader)({
      s: r[2],
      i: 0
    }, m.headers[name]);
  }

  return m;
}
exports.parseSIPMessage = parseSIPMessage;
