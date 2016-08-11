const net = require('net');
const dgram = require('dgram');
const messageHelpers = require('../messageHelpers');
const stringify = require('../stringManipulation').stringify;

module.exports = function makeUdpTransport(options, callback) {
  const address = options.address || '0.0.0.0';
  const port = options.port || 5060;
  const onMessage = function onMessage(data, rinfo) {
    const msg = messageHelpers.parse(data);

    if (msg && messageHelpers.check(msg)) {
      if (msg.method) {
        msg.headers.via[0].params.received = rinfo.address;
        if (msg.headers.via[0].params.rport) {
          msg.headers.via[0].params.rport = rinfo.port;
        }
      }

      callback(msg, {
        protocol: 'UDP',
        address: rinfo.address,
        port: rinfo.port,
        local: {
          address,
          port
        }
      });
    }
  };

  const open = function open(remote/*, error*/) {
    return {
      send(message) {
        // unsure if we should be adding rport right here
        if (options.rport) {
          message.headers.via[0].params.rport = remote.port;
        }
        const msgBuffer = Buffer.from(stringify(message), 'ascii');
        socket.send(
          msgBuffer,
          remote.port,
          remote.address
        );
      },
      protocol: 'UDP',
      release() {}
    };
  };
  const socket = dgram.createSocket(
    net.isIPv6(address) ? 'udp6' : 'udp4',
    onMessage
  );

  socket.bind(port, address);

  const udpTransport = {
    open,
    get: open,
    destroy() {
      socket.close();
    }
  };

  return udpTransport;
};
