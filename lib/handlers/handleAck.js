const generateBranch = require('../generateBranch');
const stringifyUri = require('../stringManipulation').stringifyUri;

module.exports = function handleAck(transport, m, addresses, errorLog) {
  if (!Array.isArray(m.headers.via)) {
    m.headers.via = [];
  }

  if (m.headers.via.length === 0) {
    m.headers.via.unshift({
      params: {
        branch: generateBranch()
      }
    });
  }

  if (addresses.length === 0) {
    errorLog(new Error("ACK: couldn't resolve " + stringifyUri(m.uri)));
    return;
  }

  const connection = transport.open(addresses[0], errorLog);

  try {
    connection.send(m);
  } catch (e) {
    errorLog(e);
  } finally {
    connection.release();
  }
};
