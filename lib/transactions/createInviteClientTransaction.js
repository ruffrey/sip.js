const stateMachineFactory = require('../stateMachine');
const makeResponse = require('../makeResponse');

/**
 * @private
 * @param {Request} rq
 * @param {Transport} transport
 * @param {Function} tu - callback expecting response object
 */
module.exports = function createInviteClientTransaction(rq, transport, tu, cleanup, options) {
  let timerA;
  let timerB;
  let timerD;
  let timerM;

  const sm = stateMachineFactory();
  const calling = {
    enter() {
      transport(rq);

      if (!transport.reliable) {
        timerA = setTimeout(function resend(t) {
          transport(rq);
          timerA = setTimeout(resend, t * 2, t * 2);
        }, 500, 500);
      }

      timerB = setTimeout(() => {
        tu(makeResponse(rq, 408));
        sm.enter(terminated);
      }, 32000);
    },
    leave() {
      clearTimeout(timerA);
      clearTimeout(timerB);
    },
    message(message) {
      tu(message);

      if (message.status < 200) {
        sm.enter(proceeding);
      } else if (message.status < 300) {
        sm.enter(accepted);
      } else {
        sm.enter(completed, message);
      }
    }
  };

  const proceeding = {
    message(message) {
      tu(message);

      if (message.status >= 300) {
        sm.enter(completed, message);
      } else if (message.status >= 200) {
        sm.enter(accepted);
      }
    }
  };

  const ack = {
    method: 'ACK',
    uri: rq.uri,
    headers: {
      from: rq.headers.from,
      cseq: {
        method: 'ACK',
        seq: rq.headers.cseq.seq
      },
      'call-id': rq.headers['call-id'],
      via: [rq.headers.via[0]],
      'max-forwards': (options && options['max-forwards']) || 70
    }
  };

  const completed = {
    enter(rs) {
      ack.headers.to = rs.headers.to;
      transport(ack);
      timerD = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerD);
    },
    message(message, remote) {
      if (remote) transport(ack); // we don't want to ack internally generated messages
    }
  };

  const accepted = {
    enter() {
      timerM = setTimeout(() => sm.enter(terminated), 32000);
    },
    leave() {
      clearTimeout(timerM);
    },
    message(m) {
      const isSuccessStatus = m.status >= 200 && m.status <= 299;
      if (isSuccessStatus) {
        tu(m);
      }
    }
  };

  const terminated = {
    enter: cleanup
  };

  process.nextTick(() => sm.enter(calling));

  return {
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
};
