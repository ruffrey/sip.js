const sip = require('./sip');

const contexts = {};

function makeContextId(msg) {
  const via = msg.headers.via[0];
  return [
    via.params.branch,
    via.protocol,
    via.host,
    via.port,
    msg.headers['call-id'],
    msg.headers.cseq.seq
  ];
}

function defaultCallback(rs) {
  rs.headers.via.shift();
  exports.send(rs);
}

function forwardResponse(ctx, rs, callback) {
  if (+rs.status >= 200) {
    delete contexts[makeContextId(rs)];
  }

  sip.send(rs, callback);
}

function sendCancel(rq, via, route) {
  sip.send({
    method: 'CANCEL',
    uri: rq.uri,
    headers: {
      via: [via],
      to: rq.headers.to,
      from: rq.headers.from,
      'call-id': rq.headers['call-id'],
      route,
      cseq: {
        method: 'CANCEL',
        seq: rq.headers.cseq.seq
      }
    }
  });
}

function forwardRequest(ctx, rq, callback) {
  const route = rq.headers.route && rq.headers.route.slice();
  sip.send(rq, (rs, remote) => {
    if (+rs.status < 200) {
      const via = rs.headers.via[0];
      ctx.cancellers[rs.headers.via[0].params.branch] = function () {
        sendCancel(rq, via, route);
      };

      if (ctx.cancelled) {
        sendCancel(rq, via, route);
      }
    } else {
      delete ctx.cancellers[rs.headers.via[0].params.branch];
    }

    callback(rs, remote);
  });
}

function onRequest(rq, route, remote) {
  const id = makeContextId(rq);
  contexts[id] = {
    cancellers: {}
  };

  try {
    route(sip.copyMessage(rq), remote);
  } catch (e) {
    delete contexts[id];
    throw e;
  }
}

const proxy = {
  /**
   * start a proxy. It...proxies requests, and handles cancels
   * in a special way.
   */
  start(options, route) {
    sip.start(options, (rq, remote) => {
      if (rq.method === 'CANCEL') {
        const ctx = contexts[makeContextId(rq)];

        if (ctx) {
          sip.send(sip.makeResponse(rq, 200));

          ctx.cancelled = true;
          if (ctx.cancellers) {
            Object.keys(ctx.cancellers).forEach(
              (c) => ctx.cancellers[c]()
            );
          }
          return;
        }

        sip.send(sip.makeResponse(rq, 481));

        return;
      }

      onRequest(rq, route, remote);

    });
  },
  /**
   * proxy a message using a cached context for this message
   */
  send(msg, callback) {
    const ctx = contexts[makeContextId(msg)];

    if (!ctx) {
      sip.send.apply(sip, arguments);
      return;
    }

    return msg.method
      ? forwardRequest(ctx, msg, callback || defaultCallback)
      : forwardResponse(ctx, msg);
  },
  /**
   * sip.stop
   */
  stop: sip.stop,

};

module.exports = proxy;
