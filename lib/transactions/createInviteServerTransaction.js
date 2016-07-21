const stateMachineFactory = require('../stateMachine');

module.exports = function createInviteServerTransaction(transport, cleanup) {
  let rs;
  let timerOne;
  let timerTwo;
  let timerThree;
  let timerFour;
  const sm = stateMachineFactory();
  const proceeding = {
    message() {
      if (rs) {
        transport(rs);
      }
    },
    send(message) {
      rs = message;

      if (message.status >= 300) {
        sm.enter(completed);
      } else if (message.status >= 200) {
        sm.enter(accepted);
      }

      transport(rs);
    }
  };
  const completed = {
    enter() {
      timerOne = setTimeout(function retry(t) {
        timerOne = setTimeout(retry, t * 2, t * 2);
        transport(rs);
      }, 500, 500);
      timerTwo = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerOne);
      clearTimeout(timerTwo);
    },
    message(m) {
      if (m.method === 'ACK') {
        sm.enter(confirmed);
      } else {
        transport(rs);
      }
    }
  };

  const confirmed = {
    enter() {
      timerThree = setTimeout(sm.enter.bind(sm, terminated), 5000);
    },
    leave() {
      clearTimeout(timerThree);
    }
  };

  const accepted = {
    enter() {
      timerFour = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave() {
      clearTimeout(timerFour);
    },
    send(m) {
      rs = m;
      transport(rs);
    }
  };

  const terminated = {
    enter: cleanup
  };

  sm.enter(proceeding);

  return {
    send: sm.signal.bind(sm, 'send'),
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
};
