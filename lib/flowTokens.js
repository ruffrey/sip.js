const toBase64 = require('./stringManipulation').toBase64;

/* public */

function encodeFlowToken(flow, seedForSha1) {
  const s = [flow.protocol, flow.address, flow.port, flow.local.address, flow.local.port].join();
  const sha1hash = crypto.createHmac('sha1', seedForSha1);
  sha1hash.update(s);
  return toBase64([sha1hash.digest('base64'), s].join());
}
exports.encodeFlowToken = encodeFlowToken;

exports.decodeFlowToken = function decodeFlowToken(token) {
  const s = Buffer.from(token, 'base64').toString('ascii').split(',');
  if (s.length !== 6) {
    return;
  }

  const flow = {
    protocol: s[1],
    address: s[2],
    port: +s[3],
    local: {
      address: s[4],
      port: +s[5]
    }
  };
  const encodedFlow = encodeFlowToken(flow);

  return encodedFlow === token ? flow : undefined;
};
