const makeTransactionId = require('./makeTransactionId');
const createClientTransaction = require('./createClientTransaction');
const createInviteServerTransaction = require('./createInviteServerTransaction');
const createServerTransaction = require('./createServerTransaction');
const createInviteClientTransaction = require('./createInviteClientTransaction');
const generateBranch = require('../generateBranch');
const parsers = require('../stringManipulation').parsers;

/**
 * The transaction layer creates and tracks server and client
 * transactions, and makes sure they are cleaned up afterward.
 *
 * I believe the second argument, `transport`, is not necessary
 * because when doing a transaction a connection property is passed.
 *
 */
module.exports = function makeTransactionLayer(options/*, transport*/) {
  const serverTransactions = {};
  const clientTransactions = {};

  return {
    createServerTransaction(rq, connection) {
      const id = makeTransactionId(rq);
      const isInvite = rq.method === 'INVITE';
      const transactionCreator = isInvite
        ? createInviteServerTransaction
        : createServerTransaction;
      const transactionResult = transactionCreator(
        connection.send.bind(connection),
        () => {
          delete serverTransactions[id];
          connection.release();
        }
      );
      serverTransactions[id] = transactionResult;
      return transactionResult;
    },
    createClientTransaction(connection, rq, callback) {
      if (rq.method !== 'CANCEL') {
        rq.headers.via[0].params.branch = generateBranch();
      }

      if (typeof rq.headers.cseq !== 'object') {
        rq.headers.cseq = parsers.cseq({
          s: rq.headers.cseq,
          i: 0
        });
      }

      const id = makeTransactionId(rq);
      const isInvite = rq.method === 'INVITE';
      const send = connection.send.bind(connection);
      send.reliable = connection.protocol.toUpperCase() !== 'UDP';
      const transactionCreator = isInvite
        ? createInviteClientTransaction
        : createClientTransaction;
      const transactionResult = transactionCreator(
        rq,
        send,
        callback,
        () => {
          delete clientTransactions[id];
          connection.release();
        },
        options
      );
      clientTransactions[id] = transactionResult;
      return transactionResult;
    },
    getServer(m) {
      return serverTransactions[makeTransactionId(m)];
    },
    getClient(m) {
      return clientTransactions[makeTransactionId(m)];
    },
    destroy() {
      Object.keys(clientTransactions).forEach((x) => {
        clientTransactions[x].shutdown();
      });
      Object.keys(serverTransactions).forEach((x) => {
        serverTransactions[x].shutdown();
      });
    }
  };
};
