const os = require('os');
const crypto = require('crypto');
const makeTransactionLayer = require('./lib/transactions/makeTransactionLayer');
const stringManipulation = require('./lib/stringManipulation');
const makeStreamParser = require('./lib/streamParser');
const generateBranch = require('./lib/generateBranch');
const makeResponse = require('./lib/makeResponse');
const sequentialSearch = require('./lib/sequentialSearch');
const messageHelpers = require('./lib/messageHelpers');
const dnsResolver = require('./lib/dnsResolver');
const flowTokens = require('./lib/flowTokens');
const makeTransportWrapper = require('./lib/transports/makeTransportWrapper');
exports.makeTransport = makeTransportWrapper;
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

const handleAck = require('./lib/handlers/handleAck');

/**
 * This is the expected entry point with the library.
 * Only one should be created.
 *
 * @public
 */
exports.start = function start(options, sipRequestHandler) {
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
    : () => {};

  // transport is a generic interface which handles UDP, TCP,
  // and when desired, TLS ans WebSockets
  const transport = makeTransportWrapper(options, (m, remote) => {
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
          handleAck(transport, m, addresses, errorLog);
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
