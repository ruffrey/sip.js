const clone = require('./clone');

module.exports = function copyMessage(msg, deep) {
  if (deep) return clone(msg, true);

  const r = {
    uri: deep ? clone(msg.uri, deep) : msg.uri,
    method: msg.method,
    status: msg.status,
    reason: msg.reason,
    headers: clone(msg.headers, deep),
    content: msg.content
  };

  // always copy via array
  r.headers.via = clone(msg.headers.via);

  return r;
};
