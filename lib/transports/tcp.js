const net = require('net');
const tls = require('tls');
const makeStreamParser = require('../streamParser');
const messageHelpers = require('../messageHelpers');
const stringify = require('../stringManipulation').stringify;

/* public */

exports.makeTcpTlsTransport = function makeTcpTlsTransport(options, callback) {
  return makeStreamTransport(
    'TLS',
    (port, host, cb) => tls.connect(port, host, options.tls, cb),
    (cb) => {
      const server = tls.createServer(options.tls, cb);
      server.listen(options.tls_port || 5061, options.address);
      return server;
    },
    callback);
};

exports.makeTcpTransport = function makeTcpTransport(options, callback) {
  return makeStreamTransport(
    'TCP',
    net.connect,
    (cb) => {
      const server = net.createServer(cb);
      server.listen(options.port || 5060, options.address);
      return server;
    },
    callback);
};

/* private */

function makeStreamTransport(protocol, connect, createServer, callback) {
  const remotes = {};
  const flows = {};

  function init(stream, remote) {
    const remoteid = [remote.address, remote.port].join();
    let flowid = undefined;
    let refs = 0;

    function registerFlow() {
      flowid = [remoteid, stream.localAddress, stream.localPort].join();
      flows[flowid] = remotes[remoteid];
    }

    stream.setEncoding('ascii');
    stream.on('data', makeStreamParser((m) => {
      if (messageHelpers.check(m)) {
        if (m.method) {
          m.headers.via[0].params.received = remote.address;
        }

        callback(
          m, {
            protocol: remote.protocol,
            address: stream.remoteAddress,
            port: stream.remotePort,
            local: {
              address: stream.localAddress,
              port: stream.localPort
            }
          },
          stream
        );
      }
    }));

    stream.on('close', () => {
      if (flowid) {
        delete flows[flowid];
      }
      delete remotes[remoteid];
    });
    stream.on('connect', registerFlow);

    stream.on('error', () => {});
    stream.on('end', () => {
      if (refs !== 0) {
        stream.emit('error', new Error('remote peer disconnected'));
      }
      stream.end(); // necessary?
    });

    stream.on('timeout', () => {
      if (refs === 0) {
        stream.destroy();
      }
    });
    stream.setTimeout(120000);
    stream.setMaxListeners(10000);

    remotes[remoteid] = function (onError) {
      ++refs;
      if (onError) stream.on('error', onError);

      return {
        release() {
          if (onError) {
            stream.removeListener('error', onError);
          }
          if (--refs === 0) {
            stream.emit('no_reference');
          }
        },
        send(m) {
          stream.write(stringify(m), 'ascii');
        },
        protocol
      };
    };

    if (stream.localPort) registerFlow();

    return remotes[remoteid];
  }

  const server = createServer((stream) => {
    init(stream, {
      protocol,
      address: stream.remoteAddress,
      port: stream.remotePort
    });
  });

  return {
    open(remote, error) {
      const remoteid = [
        remote.address,
        remote.port
      ].join();

      if (typeof remotes[remoteid] === 'function') {
        return remotes[remoteid](error);
      }

      return init(connect(remote.port, remote.address), remote)(error);
    },
    get(address, error) {
      // what is `c` supposed to be?
      let c;
      if (address.local) {
        const item = [
          address.address,
          address.port,
          address.local.address,
          address.local.port
        ].join();
        c = flows[item];
      } else {
        const item = [
          address.address,
          address.port
        ].join();
        c = remotes[item];
      }

      return c && c(error);
    },
    destroy() {
      server.close();
    }
  };
}
