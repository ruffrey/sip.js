const https = require('https');
const messageHelpers = require('../messageHelpers');
const stringify = require('../stringManipulation').stringify;

module.exports = function makeWsTransport(options, callback) {
  let server;

  const flows = {};
  const clients = {};

  const init = function init(ws) {
    const remote = {
      address: ws._socket.remoteAddress,
      port: ws._socket.remotePort
    };
    const local = {
      address: ws._socket.address().address,
      port: ws._socket.address().port
    };
    const flowid = [
      remote.address,
      remote.port,
      local.address,
      local.port
    ].join();

    flows[flowid] = ws;

    ws.on('close', () => {
      delete flows[flowid];
    });
    ws.on('message', (data) => {
      const msg = messageHelpers.parse(data);
      if (msg) {
        callback(msg, {
          protocol: 'WS',
          address: remote.address,
          port: remote.port,
          local
        });
      }
    });
  };

  const makeWebSocketClient = function makeWebSocketClient(uri) {
    if (clients[uri]) {
      return clients[uri]();
    }
    const socket = new WebSocket(uri, 'sip', {
      procotol: 'sip'
    });
    const queue = [];
    let refs = 0;

    function sendConnecting(m) {
      queue.push(stringify(m));
    }

    function sendOpen(m) {
      socket.send(typeof m === 'string' ? m : stringify(m));
    }

    let send = sendConnecting;

    socket.on('open', () => {
      init(socket);
      send = sendOpen;
      queue.splice(0).forEach(send);
    });

    function open(onError) {
      ++refs;
      if (onError) socket.on('error', onError);
      return {
        send(m) {
          send(m);
        },
        release() {
          if (onError) socket.removeListener('error', onError);
          if (--refs === 0) socket.terminate();
        },
        protocol: 'WS'
      };
    }
    clients[uri] = open;
    return clients[uri];
  };

  if (options.ws_port) {
    if (options.tls) {
      server = new WebSocket.Server({
        server: https.createServer(options.tls, (rq, rs) => {
          rs.writeHead(200);
          rs.end('');
        }).listen(options.ws_port)
      });
    } else {
      server = new WebSocket.Server({
        port: options.ws_port
      });
    }

    server.on('connection', init);
  }

  function get(flow) {
    const item = [flow.address, flow.port, flow.local.address, flow.local.port].join();
    const ws = flows[item];
    if (ws) {
      return {
        send(m) {
          ws.send(stringify(m));
        },
        release() {},
        protocol: 'WS'
      };
    }
    console.error( // eslint-disable-line
      'Failed to get ws for target. Target/flow was:',
      flow,
      'Flows[] were:',
      flows
    );
  }

  function wsOpenTarget(target, onError) {
    if (target.local) {
      return get(target);
    }
    return makeWebSocketClient(
      `ws://${target.host}:${target.port}`
    )(onError);
  }

  return {
    // why both of these?
    open: wsOpenTarget,
    get: wsOpenTarget,
    destroy() {
      server.close();
    }
  };
};
