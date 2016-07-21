const makeResponse = require('./makeResponse');
/**
 * Recursively connects to addresses and...does something.
 *
 * @param  {Transaction} transaction
 * @param  {Function} connect
 * @param  {Array<remote address>} addresses
 * @param  {SIPRequest} rq
 * @param  {Function} callback - called with one argument, a SIP response,
 * which would indicate a 404 if failure occurs.
 * @return {undefined}
 */
module.exports = function sequentialSearch(transaction, connect, addresses, rq, callback) {
  let onresponse;
  let lastStatusCode;

  const searching = (rs) => {
    lastStatusCode = rs.status;
    if (rs.status === 503) {
      next();
      return;
    }
    if (rs.status > 100) {
      onresponse = callback;
    }

    callback(rs);
  };
  const next = () => {
    onresponse = searching;
    const nextArgs = arguments;
    const address = addresses.shift();
    const didFinishSearch = !address;

    if (didFinishSearch) {
      onresponse = callback;
      onresponse(makeResponse(rq, lastStatusCode || 404));
      return;
    }

    try {
      const connection = connect(address, (error) => {
        if (error) {
          console.error({ error }); // eslint-disable-line
        }
        client.message(makeResponse(rq, 503));
      });
      const doneHandler = () => onresponse.apply(null, nextArgs);
      const client = transaction(connection, rq, doneHandler);
    } catch (e) {
      const errorResponse = address.local
        ? makeResponse(rq, 430)
        : makeResponse(rq, 503);
      onresponse(errorResponse);
    }
  };

  // Execute
  checkAndHandleViaHeaderForCancelRequest(rq);
  next();
};

/* private */
function checkAndHandleViaHeaderForCancelRequest(rq) {
  if (rq.method !== 'CANCEL') {
    if (!rq.headers.via) {
      rq.headers.via = [];
    }
    rq.headers.via.unshift({
      params: {}
    });
  }
}
