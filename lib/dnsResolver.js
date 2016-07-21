const dns = require('dns');
const net = require('net');

/* public */

function defaultSipPortForProtocol(sipProtocol) {
  return sipProtocol.toUpperCase() === 'TLS' ? 5061 : 5060;
}
exports.defaultSipPortForProtocol = defaultSipPortForProtocol;

/**
 * This seems to execute an action based on the URI,
 * where the URI indicated the kind of transport (ws, tcp, udp, sip/sips).
 * It will resolve DNS if necessary.
 * @param  {String} uri
 * @param  {Function} action
 * @return {?} - result of calling the action
 */
exports.resolve = function resolve(uri, action) {
  if (uri.params.transport === 'ws') {
    return action([{
      protocol: uri.schema === 'sips' ? 'WSS' : 'WS',
      host: uri.host,
      port: uri.port || (uri.schema === 'sips' ? 433 : 80)
    }]);
  }

  if (net.isIP(uri.host)) {
    const protocol = uri.params.transport || 'UDP';
    return action([{
      protocol,
      address: uri.host,
      port: uri.port || defaultSipPortForProtocol(protocol)
    }]);
  }

  if (uri.port) {
    const protocols = uri.params.transport
      ? [uri.params.transport]
      : ['UDP', 'TCP', 'TLS'];

    resolve46(uri.host, (err, addressList = []) => {
      if (err) {
        console.warn('failed resolving host', uri.host); // eslint-disable-line
        // fallthrough
      }
      const address = addressList.map((x) => (protocols.map((p) => ({
        protocol: p,
        address: x,
        port: uri.port || defaultSipPortForProtocol(p)
      })))).reduce((arr, v) => arr.concat(v), []);
      action(address);
    });
    return;
  }

  const protocols = uri.params.transport
    ? [uri.params.transport]
    : ['tcp', 'udp', 'tls'];

  let n = protocols.length;
  let addresses = [];

  protocols.forEach((proto) => {
    resolveSrv('_sip._' + proto + '.' + uri.host, (srvErr, serviceRecords) => {
      --n;

      if (Array.isArray(serviceRecords)) {
        n += serviceRecords.length;
        serviceRecords.forEach((srv) => {
          resolve46(srv.name, (ipErr, r) => {
            if (r) {
              addresses = addresses.concat(r);
            }
            addresses = addresses.map((a) => ({
              protocol: proto,
              address: a,
              port: srv.port
            }));

            const allOutstandingRequestsComplete = (--n) === 0;
            if (allOutstandingRequestsComplete) {
              action(addresses);
            }
          });
        });
        return;
      }

      if (n === 0) {
        if (addresses.length) {
          action(addresses);
          return;
        }
        // all srv requests failed
        resolve46(uri.host, (err, ipAddrLookupResults = []) => {
          // serach the dns lookup results to find the address we want.
          const address = ipAddrLookupResults.map((x) => {
            const protocolObjs = protocols.map((p) => ({
              protocol: p,
              address: x,
              port: uri.port || defaultSipPortForProtocol(p)
            }));
            return protocolObjs;
          }).reduce((arr, v) => arr.concat(v), []);

          action(address);
        });
      }
    });
  });
};

/* Private */

function makeWellBehavingResolver(resolver) {
  const outstanding = {};

  return function wellBehavingResolver(name, cb) {
    if (outstanding[name]) {
      outstanding[name].push(cb);
    } else {
      outstanding[name] = [cb];

      resolver(name, () => {
        const o = outstanding[name];
        delete outstanding[name];
        const args = arguments;
        o.forEach((x) => x.apply(null, args));
      });
    }
  };
}

// Functions for resolving DNS
const resolveSrv = makeWellBehavingResolver(dns.resolveSrv);
const resolve4 = makeWellBehavingResolver(dns.resolve4);
const resolve6 = makeWellBehavingResolver(dns.resolve6);
const resolve46 = function resolve46(host, cb) {
  resolve4(host, (e4, a4) => {
    resolve6(host, (e6, a6) => {
      if ((a4 || a6) && (a4 || a6).length) {
        cb(null, (a4 || []).concat(a6 || []));
        return;
      }
      cb(e4 || e6, []);
    });
  });
};
