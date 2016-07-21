const regExpSipUri =  /^(sips?):(?:([^\s>:@]+)(?::([^\s@>]+))?@)?([\w\-\.]+)(?::(\d+))?((?:;[^\s=\?>;]+(?:=[^\s?\;]+)?)*)(?:\?(([^\s&=>]+=[^\s&=>]+)(&[^\s&=>]+=[^\s&=>]+)*))?$/; // eslint-disable-line
const regExpHeaderParams = /\s*;\s*([\w\-.!%*_+`'~]+)(?:\s*=\s*([\w\-.!%*_+`'~]+|"[^"\\]*(\\.[^"\\]*)*"))?/g; // eslint-disable-line
const regExpMultiHeaderParam = /\s*,\s*/g;

/**
 * Make a string base64 encoded
 * @param  {String} inputString
 * @return {[type]}   [description]
 */
exports.toBase64 = function toBase64(inputString) {
  let s = inputString + ''; // copy

  switch (s.length % 3) {
    case 1:
      s += '  ';
      break;
    case 2:
      s += ' ';
      break;
    default:
  }

  return Buffer.from(s)
    .toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-');
};

function applyRegex(regex, data) {
  regex.lastIndex = data.i;
  const r = regex.exec(data.s);

  if (r && (r.index === data.i)) {
    data.i = regex.lastIndex;
    return r;
  }
}

function parseParams(data, hdr) {
  hdr.params = hdr.params || {};

  for (let r = applyRegex(regExpHeaderParams, data); r; r = applyRegex(regExpHeaderParams, data)) {
    hdr.params[r[1].toLowerCase()] = r[2];
  }

  return hdr;
}

function parseMultiHeader(parser, d, h = []) {

  do {
    h.push(parser(d));
  } while (d.i < d.s.length && applyRegex(regExpMultiHeaderParam, d));

  return h;
}

function parseAOR(data) {
  const r = applyRegex(
    /((?:[\w\-.!%*_+`'~]+)(?:\s+[\w\-.!%*_+`'~]+)*|"[^"\\]*(?:\\.[^"\\]*)*")?\s*\<\s*([^>]*)\s*\>|((?:[^\s@"<]@)?[^\s;]+)/g, // eslint-disable-line
    data
  );

  return parseParams(data, {
    name: r[1],
    uri: r[2] || r[3] || ''
  });
}
exports.parseAOR = parseAOR;

function parseAorWithUri(data) {
  const r = parseAOR(data);
  r.uri = parseUri(r.uri);
  return r;
}

function parseVia(data) {
  const r = applyRegex(/SIP\s*\/\s*(\d+\.\d+)\s*\/\s*([\S]+)\s+([^\s;:]+)(?:\s*:\s*(\d+))?/g, data);
  return parseParams(data, {
    version: r[1],
    protocol: r[2],
    host: r[3],
    port: r[4] && +r[4]
  });
}

function parseCSeq(d) {
  const r = /(\d+)\s*([\S]+)/.exec(d.s);
  return {
    seq: +r[1],
    method: unescape(r[2])
  };
}

function parseAuthHeader(d) {
  const r1 = applyRegex(/([^\s]*)\s+/g, d);
  const a = {
    scheme: r1[1]
  };
  let r2 = applyRegex(
    /([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g,
    d
  );

  a[r2[1]] = r2[2];

  while (r2 = applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d)) { // eslint-disable-line
    a[r2[1]] = r2[2];
  }

  return a;
}

function parseAuthenticationInfoHeader(d) {
  const a = {};
  let r = applyRegex(
    /([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g,
    d
  );

  a[r[1]] = r[2];

  while (r = applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d)) { // eslint-disable-line
    a[r[1]] = r[2];
  }
  return a;
}

/**
 * Turn a sip URI into an object of its parts.
 * @param  {String} s - sip or sips URI
 * @return {Object} - { schema, user, password, host, port: Integer, params, headers }
 */
function parseUri(s) {
  if (typeof s === 'object') {
    return s;
  }

  const r = regExpSipUri.exec(s);

  if (r) {
    const params = (r[6].match(/([^;=]+)(=([^;=]+))?/g) || [])
      .map((_s) => _s.split('='))
      .reduce((_params, x) => {
        _params[x[0]] = x[1] || null;
        return _params;
      }, {});
    const headers = ((r[7] || '').match(/[^&=]+=[^&=]+/g) || [])
      .map((_s) => _s.split('='))
      .reduce((_params, x) => {
        _params[x[0]] = x[1];
        return _params;
      }, {});

    return {
      schema: r[1],
      user: r[2],
      password: r[3],
      host: r[4],
      port: +r[5],
      params,
      headers
    };
  }
  // an invalid sip uri was given
  return {};
}

exports.parseUri = parseUri;

const parsers = {
  to: parseAOR,
  from: parseAOR,
  contact(v, h) {
    if (v === '*') {
      return v;
    }
    return parseMultiHeader(parseAOR, v, h);
  },
  route: parseMultiHeader.bind(0, parseAorWithUri),
  'record-route': parseMultiHeader.bind(0, parseAorWithUri),
  path: parseMultiHeader.bind(0, parseAorWithUri),
  cseq: parseCSeq,
  'content-length': (v) => +v.s,
  via: parseMultiHeader.bind(0, parseVia),
  'www-authenticate': parseMultiHeader.bind(0, parseAuthHeader),
  'proxy-authenticate': parseMultiHeader.bind(0, parseAuthHeader),
  authorization: parseMultiHeader.bind(0, parseAuthHeader),
  'proxy-authorization': parseMultiHeader.bind(0, parseAuthHeader),
  'authentication-info': parseAuthenticationInfoHeader,
  'refer-to': parseAOR
};
exports.parsers = parsers;

function stringifyVersion(v) {
  return v || '2.0';
}

function stringifyParams(params) {
  return Object.keys(params).map((n, index) => {
    const semicolon = index !== 0 ? ';' : '';
    const part2 = params[n] ? `=${params[n]}` : '';
    return `${semicolon}${n}${part2}`;
  }).join('');
}

function stringifyAOR(aor) {
  const name = aor.name || '';
  const aoruri = stringifyUri(aor.uri);
  const params = stringifyParams(aor.params);
  return `${name} <${aoruri}>${params}`;
}

function stringifyAuthHeader(a) {
  const s = [];

  Object.keys(a).forEach(n => {
    if (n !== 'scheme' && a[n] !== undefined) {
      s.push(n + '=' + a[n]);
    }
  });

  return a.scheme ? a.scheme + ' ' + s.join(',') : s.join(',');
}
exports.stringifyAuthHeader = stringifyAuthHeader;

function stringifyUri(uri) {
  if (typeof uri === 'string') {
    return uri;
  }

  let s = (uri.schema || 'sip') + ':';

  if (uri.user) {
    if (uri.password) {
      s += uri.user + ':' + uri.password + '@';
    } else {
      s += uri.user + '@';
    }
  }

  s += uri.host;

  if (uri.port) {
    s += `:${uri.port}`;
  }

  if (uri.params) {
    s += stringifyParams(uri.params);
  }

  if (uri.headers) {
    const h = Object.keys(uri.headers).map(
      (x) => `${x}=${uri.headers[x]}`
    ).join('&');
    if (h.length) {
      s += `?${h}`;
    }
  }
  return s;
}
exports.stringifyUri = stringifyUri;

function prettifyHeaderName(s) {
  if (s === 'call-id') {
    return 'Call-ID';
  }

  return s.replace(/\b([a-z])/g, (a) => a.toUpperCase());
}

const stringifiers = {
  via(h) {
    return h.map((via) => {
      if (via.host) {
        return 'Via: SIP/' +
          stringifyVersion(via.version) + '/' +
          via.protocol.toUpperCase() + ' ' + via.host +
          (via.port ? ':' + via.port : '') +
          stringifyParams(via.params) +
          '\r\n';
      }
      return '';
    }).join('');
  },
  to(h) {
    return 'To: ' + stringifyAOR(h) + '\r\n';
  },
  from(h) {
    return 'From: ' + stringifyAOR(h) + '\r\n';
  },
  contact(h) {
    return 'Contact: ' + ((h !== '*' && h.length) ? h.map(stringifyAOR).join(', ') : '*') + '\r\n';
  },
  route(h) {
    return h.length ? 'Route: ' + h.map(stringifyAOR).join(', ') + '\r\n' : '';
  },
  'record-route': (h) => (
    h.length ? 'Record-Route: ' + h.map(stringifyAOR).join(', ') + '\r\n' : ''
  ),
  path(h) {
    return h.length ? 'Path: ' + h.map(stringifyAOR).join(', ') + '\r\n' : '';
  },
  cseq(cseq) {
    return 'CSeq: ' + cseq.seq + ' ' + cseq.method + '\r\n';
  },
  'www-authenticate': (h) => (
    h.map((x) => (
      'WWW-Authenticate: ' + stringifyAuthHeader(x) + '\r\n'
    )).join('')
  ),
  'proxy-authenticate': (h) => (
    h.map(
      (x) => 'Proxy-Authenticate: ' + stringifyAuthHeader(x) + '\r\n'
    ).join('')
  ),
  authorization: (h) => (
    h.map(
      (x) => 'Authorization: ' + stringifyAuthHeader(x) + '\r\n'
    ).join('')
  ),
  'proxy-authorization': (h) => (
    h.map(
      (x) => 'Proxy-Authorization: ' + stringifyAuthHeader(x) + '\r\n'
    ).join('')
  ),

  'authentication-info': (h) => ('Authentication-Info: ' + stringifyAuthHeader(h) + '\r\n'),

  'refer-to': (h) => ('Refer-To: ' + stringifyAOR(h) + '\r\n')
};
exports.stringifiers = stringifiers;

function stringify(m) {
  let s;
  if (m.status) {
    s = 'SIP/' + stringifyVersion(m.version) + ' ' + m.status + ' ' + m.reason + '\r\n';
  } else {
    s = m.method + ' ' + stringifyUri(m.uri) + ' SIP/' + stringifyVersion(m.version) + '\r\n';
  }

  m.headers['content-length'] = (m.content || '').length;

  Object.keys(m.headers).forEach(n => {
    if (typeof m.headers[n] !== 'undefined') {
      if (typeof m.headers[n] === 'string' || !stringifiers[n]) {
        s += prettifyHeaderName(n) + ': ' + m.headers[n] + '\r\n';
      } else {
        s += stringifiers[n](m.headers[n], n);
      }
    }
  });

  s += '\r\n';

  if (m.content) {
    s += m.content;
  }

  return s;
}
exports.stringify = stringify;
