const crypto = require('crypto');
const stringifyUri = require('./sip').stringifyUri;

/* public */

function md5() {
  const hash = crypto.createHash('md5');

  const a = Array.prototype.join.call(arguments, ':');
  hash.update(a);

  return hash.digest('hex');
}
exports.md5 = md5;

function calculateUserRealmPasswordHash(user, realm, password) {
  return md5(unquote(user), unquote(realm), unquote(password));
}
exports.calculateUserRealmPasswordHash = calculateUserRealmPasswordHash;

function calculateHA1(ctx) {
  const userhash = (
    ctx.userhash
    || calculateUserRealmPasswordHash(ctx.user, ctx.realm, ctx.password)
  );

  if (lowercase(ctx.algorithm) === 'md5-sess') {
    return md5(userhash, ctx.nonce, ctx.cnonce);
  }

  return userhash;
}
exports.calculateHA1 = calculateHA1;

function calculateDigest(ctx) {
  switch (ctx.qop) {
    case 'auth-int':
      return md5(
        ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop,
        md5(ctx.method, ctx.uri, md5(ctx.entity))
      );
    case 'auth':
      return md5(ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop, md5(ctx.method, ctx.uri));
    default:
  }

  return md5(ctx.ha1, ctx.nonce, md5(ctx.method, ctx.uri));
}
exports.calculateDigest = calculateDigest;

function generateNonce(tag, seedTimestamp = new Date()) {
  const tstamp = seedTimestamp.toISOString();
  const nonceSalt = randomHexBytes();
  const nonce = [tstamp, md5(tstamp, tag, nonceSalt)].join(';');
  const nonceBuffer = Buffer.from(nonce, 'ascii');
  return nonceBuffer.toString('base64');
}
exports.generateNonce = generateNonce;

function extractNonceTimestamp(nonce, tag) {
  const v = new Buffer(nonce, 'base64').toString('ascii').split(';');
  if (v.length !== 2) {
    return;
  }

  const ts = new Date(v[0]);

  return generateNonce(tag, ts) === nonce && ts;
}
exports.extractNonceTimestamp = extractNonceTimestamp;

exports.challenge = function challenge(ctx, rs) {
  ctx.proxy = rs.status === 407;

  ctx.nonce = ctx.cnonce || randomHexBytes();
  ctx.nc = 0;
  ctx.qop = ctx.qop || 'auth,auth-int';
  ctx.algorithm = ctx.algorithm || 'md5';

  const hname = ctx.proxy ? 'proxy-authenticate' : 'www-authenticate';

  if (!rs.headers[hname]) {
    rs.headers[hname] = [];
  }

  rs.headers[hname].push({
    scheme: 'Digest',
    realm: quote(ctx.realm),
    qop: quote(ctx.qop),
    algorithm: quote(ctx.algorithm),
    nonce: quote(ctx.nonce),
    opaque: quote(ctx.opaque)
  });

  return rs;
};

exports.authenticateRequest = function authenticateRequest(ctx, rq, creds) {
  const authHeader = rq.headers[ctx.proxy ? 'proxy-authorization' : 'authorization'];
  const response = findDigestRealm(
      authHeader,
      ctx.realm
  );

  if (!response) {
    // clear this crap on the challenge
    ctx.nonce = null;
    ctx.userhash = null;
    ctx.algorithm = null;
    ctx.ha1 = null;
    ctx._lastDigest = null;
    ctx._lastResponse = null;
    return false;
  }

  const cnonce = unquote(response.cnonce);
  const uri = unquote(response.uri);
  const qop = unquote(lowercase(response.qop));

  ctx.nc = (ctx.nc || 0) + 1;

  if (!ctx.ha1) {
    ctx.userhash = (
      creds.hash || calculateUserRealmPasswordHash(creds.user, ctx.realm, creds.password)
    );
    ctx.ha1 = ctx.userhash;
    if (lowercase(ctx.algorithm) === 'md5-sess') {
      ctx.ha1 = md5(ctx.userhash, ctx.nonce, cnonce);
    }
  }

  const digest = calculateDigest({
    ha1: ctx.ha1,
    method: rq.method,
    nonce: ctx.nonce,
    nc: numberTo8Hex(ctx.nc),
    cnonce,
    qop,
    uri,
    entity: rq.content
  });

  ctx._lastDigest = digest;
  ctx._lastResponse = unquote(response.response);

  if (digest === unquote(response.response)) {
    ctx.cnonce = cnonce;
    ctx.uri = uri;
    ctx.qop = qop;

    return true;
  }

  return false;
};

exports.signRequest = function signRequest(ctx = {}, rq, rs, creds) {
  if (rs) {
    initClientContext(ctx, rs, creds);
  }

  // watdafuq?
  const nc = ctx.nc !== undefined ? numberTo8Hex(++ctx.nc) : undefined;

  ctx.uri = stringifyUri(rq.uri);

  const signature = {
    scheme: 'Digest',
    realm: quote(ctx.realm),
    username: quote(ctx.user),
    nonce: quote(ctx.nonce),
    uri: quote(ctx.uri),
    nc,
    algorithm: quote(ctx.algorithm),
    cnonce: quote(ctx.cnonce),
    qop: ctx.qop,
    opaque: quote(ctx.opaque),
    response: quote(calculateDigest({
      ha1: ctx.ha1,
      method: rq.method,
      nonce: ctx.nonce,
      nc,
      cnonce: ctx.cnonce,
      qop: ctx.qop,
      uri: ctx.uri,
      entity: rq.content
    }))
  };

  const hname = ctx.proxy ? 'proxy-authorization' : 'authorization';

  rq.headers[hname] = (rq.headers[hname] || []).filter((x) => (
    unquote(x.realm) !== ctx.realm
  ));
  rq.headers[hname].push(signature);

  return ctx.qop ? ctx : null;
};

exports.signResponse = function signResponse(ctx, rs) {
  const nc = numberTo8Hex(ctx.nc);
  rs.headers['authentication-info'] = {
    qop: ctx.qop,
    cnonce: quote(ctx.cnonce),
    nc,
    rspauth: quote(calculateDigest({
      ha1: ctx.ha1,
      method: '',
      nonce: ctx.nonce,
      nc,
      cnonce: ctx.cnonce,
      qop: ctx.qop,
      uri: ctx.uri,
      entity: rs.content
    }))
  };
  return rs;
};

exports.authenticateResponse = function authenticateResponse(ctx, rs) {
  const signature = rs.headers[ctx.proxy ? 'proxy-authentication-info' : 'authentication-info'];

  if (!signature) return undefined;

  const digest = calculateDigest({
    ha1: ctx.ha1,
    method: '',
    nonce: ctx.nonce,
    nc: numberTo8Hex(ctx.nc),
    cnonce: ctx.cnonce,
    qop: ctx.qop,
    uri: ctx.uri,
    enity: rs.content
  });
  if (digest === unquote(signature.rspauth)) {
    const nextnonce = unquote(signature.nextnonce);
    if (nextnonce && nextnonce !== ctx.nonce) {
      ctx.nonce = nextnonce;
      ctx.nc = 0;

      if (lowercase(ctx.algorithm) === 'md5-sess') {
        ctx.ha1 = md5(ctx.userhash, ctx.nonce, ctx.cnonce);
      }
    }

    return true;
  }

  return false;
};

/* private */

function initClientContext(ctx, rs, creds) {
  let challenge;

  if (rs.status === 407) {
    ctx.proxy = true;
    challenge = findDigestRealm(rs.headers['proxy-authenticate'], creds.realm);
  } else {
    challenge = findDigestRealm(rs.headers['www-authenticate'], creds.realm);
  }

  if (ctx.nonce !== unquote(challenge.nonce)) {
    ctx.nonce = unquote(challenge.nonce);

    ctx.algorithm = unquote(lowercase(challenge.algorithm));
    ctx.qop = selectQop(lowercase(challenge.qop), ctx.qop);

    if (ctx.qop) {
      ctx.nc = 0;
      ctx.cnonce = randomHexBytes();
    }

    ctx.realm = unquote(challenge.realm);
    ctx.user = creds.user;
    ctx.userhash = (
      creds.hash || calculateUserRealmPasswordHash(creds.user, ctx.realm, creds.password)
    );
    ctx.ha1 = ctx.userhash;

    if (ctx.algorithm === 'md5-sess') {
      ctx.ha1 = md5(ctx.ha1, ctx.nonce, ctx.cnonce);
    }

    ctx.domain = unquote(challenge.domain);
  }

  ctx.opaque = unquote(challenge.opaque);
}

function unquote(a) {
  if (a && a[0] === '"' && a[a.length - 1] === '"') {
    return a.substr(1, a.length - 2);
  }
  return a;
}

function quote(a) {
  if (typeof a === 'string' && a[0] !== '"') {
    return ['"', a, '"'].join('');
  }
  return a;
}

function lowercase(a) {
  if (typeof a === 'string') {
    return a.toLowerCase();
  }
  return a;
}

function randomHexBytes() {
  return md5(Math.random().toString(), Math.random().toString());
}

function numberTo8Hex(n) {
  const numAsString = n.toString(16);
  return '00000000'.substr(numAsString.length) + numAsString;
}

function findDigestRealm(headers, realm) {
  if (!realm) return headers && headers[0];
  return headers && headers.filter((x) => (
    x.scheme.toLowerCase() === 'digest' && unquote(x.realm) === realm
  ))[0];
}

function selectQop(challengeInQuotes, preference) {
  if (!challengeInQuotes) {
    return;
  }

  const challenge = unquote(challengeInQuotes).split(',');
  if (!preference) {
    return challenge[0];
  }

  // preference needs to be an array
  const preferences = typeof(preference) === 'string'
    ? preference.split(',')
    : preference;

  for (let i = 0; i !== preferences.length; ++i) {
    for (let j = 0; j !== challenge.length; ++j) {
      if (challenge[j] === preferences[i]) {
        return challenge[j];
      }
    }
  }

  throw new Error('failed to negotiate protection quality');
}
