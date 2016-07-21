const assert = require('assert');
const stateMachineFactory = require('../stateMachine');
const makeResponse = require('../makeResponse');

module.exports = function createClientTransaction(rq, transport, tu, cleanup) {
  // TODO: hell no
  assert.ok(rq.method !== 'INVITE');

  const sm = stateMachineFactory();
  let timerE; // timer
  let timerF; // timer
  let k; // timer

  const trying = {
    enter() {
      transport(rq);
      if (!transport.reliable) {
        timerE = setTimeout(() => sm.signal('timerE', 500), 500);
      }
      timerF = setTimeout(() => sm.signal('timerF'), 32000);
    },
    leave() {
      clearTimeout(timerE);
      clearTimeout(timerF);
    },
    message(message/*, remote*/) {
      if (message.status >= 200) {
        sm.enter(completed);
      } else {
        sm.enter(proceeding);
      }
      tu(message);
    },
    timerE(milliseconds) {
      transport(rq);
      const doubletime = milliseconds * 2;
      timerE = setTimeout(
        () => sm.signal('timerE', doubletime + 0),
        doubletime + 0
      );
    },
    timerF() {
      tu(makeResponse(rq, 408));
      sm.enter(terminated);
    }
  };

  const proceeding = {
    message(message/*, remote*/) {
      if (message.status >= 200) {
        sm.enter(completed);
      }
      tu(message);
    }
  };

  const completed = {
    enter() {
      k = setTimeout(() => sm.enter(terminated), 5000);
    },
    leave() {
      clearTimeout(k);
    }
  };

  const terminated = {
    enter: cleanup
  };

  process.nextTick(() => sm.enter(trying));

  return {
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
};
