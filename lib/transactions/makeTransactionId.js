module.exports = function makeTransactionId(m) {
  if (m.method === 'ACK') {
    return [
      'INVITE',
      m.headers['call-id'],
      m.headers.via[0].params.branch
    ].join();
  }

  return [
    m.headers.cseq.method,
    m.headers['call-id'],
    m.headers.via[0].params.branch
  ].join();
};
