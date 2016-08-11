const os = require('os');
const WebSocket = require('ws');
const makeUdpTransport = require('./udp');
const makeWsTransport = require('./ws');
const tcpTransports = require('./tcp');
const makeTcpTransport = tcpTransports.makeTcpTransport;
const makeTcpTlsTransport = tcpTransports.makeTcpTlsTransport;
const dnsResolver = require('../dnsResolver');
const defaultSipPortForProtocol = dnsResolver.defaultSipPortForProtocol;

/**
 * Make a Transport service which wraps TCP and UDP transports
 * @public
 * @return {Transport}
 */
module.exports = function makeTransportWrapper(options, callback) {
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

  function wrapTransport(obj, target) {
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

            const isUDP = this.protocol === 'UDP';
            if (isUDP && !options.rport) {
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

  const transportWrapper = {
    open(target, error) {
      return wrapTransport(protocols[target.protocol.toUpperCase()].open(target, error), target);
    },
    get(target, error) {
      const flow = protocols[target.protocol.toUpperCase()].get(target, error);
      if (flow) {
        return wrapTransport(flow, target);
      }
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
  return transportWrapper;
};
