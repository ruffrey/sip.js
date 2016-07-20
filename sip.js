const assert = require('assert');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');
const makeUdpTransport = require('./lib/transports/udp');
const makeWsTransport = require('./lib/transports/ws');
const tcpTransports = require('./lib/transports/tcp');
const makeTcpTransport = tcpTransports.makeTcpTransport;
const makeTcpTlsTransport = tcpTransports.makeTcpTlsTransport;
const stringManipulation = require('./lib/stringManipulation');
const stateMachineFactory = require('./lib/stateMachine');
const makeStreamParser = require('./lib/streamParser');
const generateBranch = require('./lib/generateBranch');
const makeResponse = require('./lib/makeResponse');
const makeTransactionId = require('./lib/makeTransactionId');
const messageHelpers = require('./lib/messageHelpers');
const dnsResolver = require('./lib/dnsResolver');
const flowTokens = require('./lib/flowTokens');
const defaultSipPortForProtocol = dnsResolver.defaultSipPortForProtocol;
exports.makeStreamParser = makeStreamParser;
exports.generateBranch = generateBranch;
exports.makeResponse = makeResponse;
exports.parse = messageHelpers.parse;

const parsers = stringManipulation.parsers;
const stringifyUri = stringManipulation.stringifyUri;
const stringifyAuthHeader = stringManipulation.stringifyAuthHeader;
const stringify = stringManipulation.stringify;
const parseUri = stringManipulation.parseUri;
const encodeFlowToken = flowTokens.encodeFlowToken;
const decodeFlowToken = flowTokens.decodeFlowToken;

exports.stringifyUri = stringifyUri;
exports.stringifyAuthHeader = stringifyAuthHeader;
exports.stringify = stringify;
exports.parseUri = parseUri;

/**
 * This is the expected entry point with the library.
 * Only one should be created.
 *
 * @public
 */
exports.start = function (options, sipRequestHandler) {
  const r = exports.create(options, sipRequestHandler);

  // this is really bad JavaScript
  exports.send = r.send;
  exports.stop = r.destroy;
  exports.encodeFlowUri = r.encodeFlowUri;
  exports.decodeFlowUri = r.decodeFlowUri;
  exports.isFlowUri = r.isFlowUri;
  exports.hostname = r.hostname;
};

/**
 * Create a sip server
 *
 * @public
 * @param  {Object}   options
 * @param  {Function} sipRequestHandler
 * @return {Object} - Several property methods
 */
exports.create = function createSipServer(options, sipRequestHandler) {
  const errorLog = options.logger && options.logger.error
    ? options.logger.error
    : function () {};

  // transport is the transport method (udp, tcp)
  const transport = makeTransport(options, (m, remote) => {
    const localTransaction = m.method
      ? transactionService.getServer(m)
      : transactionService.getClient(m);

    try {
      if (localTransaction && localTransaction.message) {
        localTransaction.message(m, remote);
        return;
      }
      if (m.method && m.method !== 'ACK') {
        const t = transactionService.createServerTransaction(m, transport.get(remote));
        try {
          sipRequestHandler(m, remote);
        } catch (e) {
          t.send(makeResponse(m, '500', 'Internal Server Error'));
          throw e;
        }
      } else if (m.method === 'ACK') {
        sipRequestHandler(m, remote);
      } else {
        errorLog(
          new Error('Skipping handling of msg due to lack of method')
        );
      }
    } catch (userHandlerFailed) {
      errorLog(userHandlerFailed);
    }
  });

  const transactionService = makeTransactionLayer(
    options,
    transport.open.bind(transport)
  );
  const hostname = options.publicAddress || options.address || options.hostname || os.hostname();
  const seedForSha1 = crypto.randomBytes(20);

  const sipServer = {
    /**
     * `sip.send`
     * @param  {Object} m - a parsed sip message
     * @param  {Function} sendCallback
     * @return {undefined}
     */
    send(m, sendCallback = () => {}) {
      if (m.method === undefined) {
        const t = transactionService.getServer(m);
        if (t && t.send) {
          t.send(m);
        }
        return;
      }

      let hop = parseUri(m.uri);

      if (typeof m.headers.route === 'string') {
        m.headers.route = parsers.route({
          s: m.headers.route,
          i: 0
        });
      }

      if (m.headers.route && m.headers.route.length > 0) {
        hop = parseUri(m.headers.route[0].uri);
        if (hop.host === hostname) {
          m.headers.route.shift();
        } else if (hop.params.lr === undefined) {
          m.headers.route.shift();
          m.headers.route.push({
            uri: m.uri
          });
          m.uri = hop;
        }
      }

      function finallySendToAddresses(addresses) {
        if (m.method === 'ACK') {
          if (!Array.isArray(m.headers.via)) {
            m.headers.via = [];
          }

          if (m.headers.via.length === 0) {
            m.headers.via.unshift({
              params: {
                branch: generateBranch()
              }
            });
          }

          if (addresses.length === 0) {
            errorLog(new Error("ACK: couldn't resolve " + stringifyUri(m.uri)));
            return;
          }

          const connection = transport.open(addresses[0], errorLog);
          try {
            connection.send(m);
          } catch (e) {
            errorLog(e);
          } finally {
            connection.release();
          }
          return;
        }

        const trans = transactionService.createClientTransaction.bind(transactionService);
        const transportConnectFunction = transport.open.bind(transport);

        sequentialSearch(
          trans,
          transportConnectFunction,
          addresses,
          m,
          sendCallback
        );
      }

      if (hop.host === hostname) {
        const flowToken = decodeFlowToken(hop.user);
        finallySendToAddresses(flowToken ? [flowToken] : []);
        return;
      }

      dnsResolver.resolve(hop, finallySendToAddresses);
    },
    encodeFlowUri(flow) {
      return {
        schema: flow.protocol === 'TLS' ? 'sips' : 'sip',
        user: encodeFlowToken(flow, seedForSha1),
        host: hostname,
        params: {}
      };
    },
    decodeFlowUri(encodedURI) {
      const uri = parseUri(encodedURI);
      return uri.host === hostname
        ? decodeFlowToken(uri.user)
        : undefined;
    },
    isFlowUri(uri) {
      return !sipServer.decodeFlowUri(uri);
    },
    hostname() {
      return hostname;
    },
    destroy() {
      transactionService.destroy();
      transport.destroy();
    }
  };

  return sipServer;
};

/**
 * @public
 */
function makeTransport(options, callback) {
  let protocols = {};
  let callbackAndLog = callback;

  if (options.logger && options.logger.recv) {
    callbackAndLog = function (m, remote, stream) {
      options.logger.recv(m, remote);
      callback(m, remote, stream);
    };
  }

  if (options.udp === undefined || options.udp) {
    protocols.UDP = makeUdpTransport(options, callbackAndLog);
  }
  if (options.tcp === undefined || options.tcp) {
    protocols.TCP = makeTcpTransport(options, callbackAndLog);
  }
  if (options.tls) {
    protocols.TLS = makeTcpTlsTransport(options, callbackAndLog);
  }
  if (options.ws_port && WebSocket) {
    protocols.WS = makeWsTransport(options, callbackAndLog);
  }

  // wrap what?
  function wrap(obj, target) {
    return Object.create(obj, {
      send: {
        value(m) {
          if (m.method) {
            const viaHost = (
              options.publicAddress
              || options.address
              || options.hostname
              || os.hostname()
            );
            const viaPort = (
              options.port
              || defaultSipPortForProtocol(this.protocol)
            );
            m.headers.via[0].host = viaHost;
            m.headers.via[0].port = viaPort;
            m.headers.via[0].protocol = this.protocol;

            if (this.protocol === 'UDP' && !options.rport) {
              m.headers.via[0].params.rport = null;
            }
          }
          if (options.logger && options.logger.send) {
            options.logger.send(m, target);
          }
          obj.send(m);
        }
      }
    });
  }

  return {
    open(target, error) {
      return wrap(protocols[target.protocol.toUpperCase()].open(target, error), target);
    },
    get(target, error) {
      const flow = protocols[target.protocol.toUpperCase()].get(target, error);
      return flow && wrap(flow, target);
    },
    send(target, message) {
      const cn = this.open(target);
      try {
        cn.send(message);
      } finally {
        cn.release();
      }
    },
    destroy() {
      const oldProtocolsReference = protocols;
      protocols = [];
      Object.keys(oldProtocolsReference).forEach(
        key => oldProtocolsReference[key].destroy()
      );
    },
  };
}
exports.makeTransport = makeTransport;

/* private */

/**
 * The transaction layer tracks server and client transactions, and
 * makes sure they are cleaned up afterward.
 *
 * I believe the second argument, `transport`, is not necessary
 * because when doing a transaction a connection property is passed.
 *
 * @private
 */
function makeTransactionLayer(options/*, transport*/) {
  const serverTransactions = {};
  const clientTransactions = {};

  return {
    createServerTransaction(rq, connection) {
      const id = makeTransactionId(rq);
      const isInvite = rq.method === 'INVITE';
      const transactionCreator = isInvite
        ? createInviteServerTransaction
        : createServerTransaction;
      const transactionResult = transactionCreator(
        connection.send.bind(connection),
        () => {
          delete serverTransactions[id];
          connection.release();
        }
      );
      serverTransactions[id] = transactionResult;
      return transactionResult;
    },
    createClientTransaction(connection, rq, callback) {
      if (rq.method !== 'CANCEL') {
        rq.headers.via[0].params.branch = generateBranch();
      }

      if (typeof rq.headers.cseq !== 'object') {
        rq.headers.cseq = parsers.cseq({
          s: rq.headers.cseq,
          i: 0
        });
      }

      const id = makeTransactionId(rq);
      const isInvite = rq.method === 'INVITE';
      const send = connection.send.bind(connection);
      send.reliable = connection.protocol.toUpperCase() !== 'UDP';
      const transactionCreator = isInvite
        ? createInviteClientTransaction
        : createClientTransaction;
      const transactionResult = transactionCreator(
        rq,
        send,
        callback,
        () => {
          delete clientTransactions[id];
          connection.release();
        },
        options
      );
      clientTransactions[id] = transactionResult;
      return transactionResult;
    },
    getServer(m) {
      return serverTransactions[makeTransactionId(m)];
    },
    getClient(m) {
      return clientTransactions[makeTransactionId(m)];
    },
    destroy() {
      Object.keys(clientTransactions).forEach((x) => {
        clientTransactions[x].shutdown();
      });
      Object.keys(serverTransactions).forEach((x) => {
        serverTransactions[x].shutdown();
      });
    }
  };
}

/**
 * @private
 */
function createServerTransaction(transport, cleanup) {
  const sm = stateMachineFactory();
  let rsTimeout;
  let rs;

  const trying = {
    message() {
      if (rs) transport(rs);
    },
    send(m) {
      rs = m;
      transport(m);
      if (m.status >= 200) sm.enter(completed);
    }
  };

  const completed = {
    message() {
      transport(rs);
    },
    enter() {
      rsTimeout = setTimeout(() => sm.enter(terminated), 32000);
    },
    leave() {
      clearTimeout(rsTimeout);
    }
  };

  const terminated = {
    enter: cleanup
  };

  sm.enter(trying);

  return {
    send: sm.signal.bind(sm, 'send'),
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
}

/**
 * @private
 */
function createInviteServerTransaction(transport, cleanup) {
  let rs;
  let timerOne;
  let timerTwo;
  let timerThree;
  let timerFour;
  const sm = stateMachineFactory();
  const proceeding = {
    message() {
      if (rs) {
        transport(rs);
      }
    },
    send(message) {
      rs = message;

      if (message.status >= 300) {
        sm.enter(completed);
      } else if (message.status >= 200) {
        sm.enter(accepted);
      }

      transport(rs);
    }
  };
  const completed = {
    enter() {
      timerOne = setTimeout(function retry(t) {
        timerOne = setTimeout(retry, t * 2, t * 2);
        transport(rs);
      }, 500, 500);
      timerTwo = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerOne);
      clearTimeout(timerTwo);
    },
    message(m) {
      if (m.method === 'ACK') {
        sm.enter(confirmed);
      } else {
        transport(rs);
      }
    }
  };

  const confirmed = {
    enter() {
      timerThree = setTimeout(sm.enter.bind(sm, terminated), 5000);
    },
    leave() {
      clearTimeout(timerThree);
    }
  };

  const accepted = {
    enter() {
      timerFour = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerFour);
    },
    send(m) {
      rs = m;
      transport(rs);
    }
  };

  const terminated = {
    enter: cleanup
  };

  sm.enter(proceeding);

  return {
    send: sm.signal.bind(sm, 'send'),
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
}

/**
 * @private
 * @param {Request} rq
 * @param {Transport} transport
 * @param {Function} tu - callback expecting response object
 */
function createInviteClientTransaction(rq, transport, tu, cleanup, options) {
  let timerA;
  let timerB;
  let timerD;
  let timerM;

  const sm = stateMachineFactory();
  const calling = {
    enter() {
      transport(rq);

      if (!transport.reliable) {
        timerA = setTimeout(function resend(t) {
          transport(rq);
          timerA = setTimeout(resend, t * 2, t * 2);
        }, 500, 500);
      }

      timerB = setTimeout(() => {
        tu(makeResponse(rq, 408));
        sm.enter(terminated);
      }, 32000);
    },
    leave() {
      clearTimeout(timerA);
      clearTimeout(timerB);
    },
    message(message) {
      tu(message);

      if (message.status < 200) {
        sm.enter(proceeding);
      } else if (message.status < 300) {
        sm.enter(accepted);
      } else {
        sm.enter(completed, message);
      }
    }
  };

  const proceeding = {
    message(message) {
      tu(message);

      if (message.status >= 300) {
        sm.enter(completed, message);
      } else if (message.status >= 200) {
        sm.enter(accepted);
      }
    }
  };

  const ack = {
    method: 'ACK',
    uri: rq.uri,
    headers: {
      from: rq.headers.from,
      cseq: {
        method: 'ACK',
        seq: rq.headers.cseq.seq
      },
      'call-id': rq.headers['call-id'],
      via: [rq.headers.via[0]],
      'max-forwards': (options && options['max-forwards']) || 70
    }
  };

  const completed = {
    enter(rs) {
      ack.headers.to = rs.headers.to;
      transport(ack);
      timerD = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerD);
    },
    message(message, remote) {
      if (remote) transport(ack); // we don't want to ack internally generated messages
    }
  };

  const accepted = {
    enter() {
      timerM = setTimeout(() => sm.enter(terminated), 32000);
    },
    leave() {
      clearTimeout(timerM);
    },
    message(m) {
      const isSuccessStatus = m.status >= 200 && m.status <= 299;
      if (isSuccessStatus) {
        tu(m);
      }
    }
  };

  const terminated = {
    enter: cleanup
  };

  process.nextTick(() => sm.enter(calling));

  return {
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
}

/**
 * @private
 */
function createClientTransaction(rq, transport, tu, cleanup) {
  // TODO: hell no
  assert.ok(rq.method !== 'INVITE');

  const sm = stateMachineFactory();
  let timerE; // timer
  let timerF; // timer
  let k; // timer

  const trying = {
    enter() {
      transport(rq);
      if (!transport.reliable) {
        timerE = setTimeout(() => sm.signal('timerE', 500), 500);
      }
      timerF = setTimeout(() => sm.signal('timerF'), 32000);
    },
    leave() {
      clearTimeout(timerE);
      clearTimeout(timerF);
    },
    message(message/*, remote*/) {
      if (message.status >= 200) {
        sm.enter(completed);
      } else {
        sm.enter(proceeding);
      }
      tu(message);
    },
    timerE(milliseconds) {
      transport(rq);
      const doubletime = milliseconds * 2;
      timerE = setTimeout(
        () => sm.signal('timerE', doubletime + 0),
        doubletime + 0
      );
    },
    timerF() {
      tu(makeResponse(rq, 408));
      sm.enter(terminated);
    }
  };

  const proceeding = {
    message(message/*, remote*/) {
      if (message.status >= 200) {
        sm.enter(completed);
      }
      tu(message);
    }
  };

  const completed = {
    enter() {
      k = setTimeout(() => sm.enter(terminated), 5000);
    },
    leave() {
      clearTimeout(k);
    }
  };

  const terminated = {
    enter: cleanup
  };

  process.nextTick(() => sm.enter(trying));

  return {
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
}

/**
 * @private
 */
function sequentialSearch(transaction, connect, addresses, rq, callback) {
  if (rq.method !== 'CANCEL') {
    if (!rq.headers.via) {
      rq.headers.via = [];
    }
    rq.headers.via.unshift({
      params: {}
    });
  }

  let onresponse;
  let lastStatusCode;
  const searching = function searching(rs) {
    lastStatusCode = rs.status;
    if (rs.status === 503) {
      return next();
    }
    if (rs.status > 100) {
      onresponse = callback;
    }

    callback(rs);
  };

  function next() {
    onresponse = searching;
    const nextArgs = arguments;
    if (addresses.length > 0) {
      let address;
      try {
        address = addresses.shift();
        const connection = connect(address, (error) => {
          if (error) {
            console.error({ error }); // eslint-disable-line
          }
          client.message(makeResponse(rq, 503));
        });
        const doneHandler = () => onresponse.apply(null, nextArgs);
        const client = transaction(connection, rq, doneHandler);
      } catch (e) {
        const errorResponse = address.local
          ? makeResponse(rq, 430)
          : makeResponse(rq, 503);
        onresponse(errorResponse);
      }
    } else {
      onresponse = callback;
      onresponse(makeResponse(rq, lastStatusCode || 404));
    }
  }

  next();
}
