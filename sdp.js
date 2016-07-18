const parsers = {
  o(o) {
    const t = o.split(/\s+/);
    return {
      username: t[0],
      id: t[1],
      version: t[2],
      nettype: t[3],
      addrtype: t[4],
      address: t[5]
    };
  },
  c(c) {
    const t = c.split(/\s+/);
    return {
      nettype: t[0],
      addrtype: t[1],
      address: t[2]
    };
  },
  m(m) {
    const t = /^(\w+) +(\d+)(?:\/(\d))? +(\S+) (\d+( +\d+)*)/.exec(m);

    return {
      media: t[1],
      port: +t[2],
      portnum: +(t[3] || 1),
      proto: t[4],
      fmt: t[5].split(/\s+/).map((x) => +x)
    };
  },
  a(a) {
    return a;
  }
};

/**
 * Turn an sdp string into an object.
 * @param {String} sdp
 * @returns {Object}
 */
exports.parse = function parseSdpStringToObject(sdp) {
  const sdpLines = sdp.split(/\r\n/);

  const root = {};
  let m;
  root.m = [];

  for (let i = 0; i < sdpLines.length; ++i) {
    const tmp = /^(\w)=(.*)/.exec(sdpLines[i]);

    if (tmp) {

      const c = (parsers[tmp[1]] || function (x) {
        return x;
      })(tmp[2]);
      switch (tmp[1]) {
        case 'm':
          if (m) root.m.push(m);
          m = c;
          break;
        case 'a':
          const o = (m || root);
          if (o.a === undefined) o.a = [];
          o.a.push(c);
          break;
        default:
          (m || root)[tmp[1]] = c;
          break;
      }
    }
  }

  if (m) root.m.push(m);

  return root;
};

const stringifiers = {
  o(o) {
    return [
      o.username || '-',
      o.id,
      o.version,
      o.nettype || 'IN',
      o.addrtype || 'IP4',
      o.address
    ].join(' ');
  },
  c(c) {
    return [
      c.nettype || 'IN',
      c.addrtype || 'IP4',
      c.address
    ].join(' ');
  },
  m(m) {
    return [
      m.media || 'audio',
      m.port,
      m.proto || 'RTP/AVP',
      m.fmt.join(' ')
    ].join(' ');
  }
};

function stringifySdpParam(sdp, type, def) {
  if (sdp[type] !== undefined) {
    const stringifier = (x) => {
      const strX = ((stringifiers[type] && stringifiers[type](x)) || x);
      return `${type}=${strX}\r\n`;
    };

    if (Array.isArray(sdp[type])) {
      return sdp[type].map(stringifier).join('');
    }

    return stringifier(sdp[type]);
  }

  if (def !== undefined) {
    return `${type}=${def}\r\n`;
  }
  return '';
}

/**
 * Turn an sdp object into a string.
 * @param {Object} sdp
 * @returns {String}
 */
exports.stringify = function stringifySdpObject(sdp) {
  let s = '';

  s += stringifySdpParam(sdp, 'v', 0);
  s += stringifySdpParam(sdp, 'o');
  s += stringifySdpParam(sdp, 's', '-');
  s += stringifySdpParam(sdp, 'i');
  s += stringifySdpParam(sdp, 'u');
  s += stringifySdpParam(sdp, 'e');
  s += stringifySdpParam(sdp, 'p');
  s += stringifySdpParam(sdp, 'c');
  s += stringifySdpParam(sdp, 'b');
  s += stringifySdpParam(sdp, 't', '0 0');
  s += stringifySdpParam(sdp, 'r');
  s += stringifySdpParam(sdp, 'z');
  s += stringifySdpParam(sdp, 'k');
  s += stringifySdpParam(sdp, 'a');

  sdp.m.forEach((m) => {
    s += stringifySdpParam({ m }, 'm');
    s += stringifySdpParam(m, 'i');
    s += stringifySdpParam(m, 'c');
    s += stringifySdpParam(m, 'b');
    s += stringifySdpParam(m, 'k');
    s += stringifySdpParam(m, 'a');
  });

  return s;
};
