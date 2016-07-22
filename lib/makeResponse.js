/**
 * Create a SIP response object which can then be relayed as a message.
 */
module.exports = function makeResponse(rq, status, reason = '', extension) {
  const rs = {
    status,
    reason,
    version: rq.version,
    headers: {
      via: rq.headers.via,
      to: rq.headers.to,
      from: rq.headers.from,
      'call-id': rq.headers['call-id'],
      cseq: rq.headers.cseq
    }
  };

  if (extension) {
    if (extension.headers) {
      Object.keys(extension.headers).forEach((h) => {
        rs.headers[h] = extension.headers[h];
      });
    }
    rs.content = extension.content;
  }

  return rs;
};
