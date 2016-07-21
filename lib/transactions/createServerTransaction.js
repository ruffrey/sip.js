const stateMachineFactory = require('../stateMachine');

module.exports = function createServerTransaction(transport, cleanup) {
  const sm = stateMachineFactory();
  let rsTimeout;
  let rs;

  const trying = {
    message() {
      if (rs) transport(rs);
    },
    send(m) {
      rs = m;
      transport(m);
      if (m.status >= 200) sm.enter(completed);
    }
  };

  const completed = {
    message() {
      transport(rs);
    },
    enter() {
      rsTimeout = setTimeout(() => sm.enter(terminated), 32000);
    },
    leave() {
      clearTimeout(rsTimeout);
    }
  };

  const terminated = {
    enter: cleanup
  };

  sm.enter(trying);

  return {
    send: sm.signal.bind(sm, 'send'),
    message: sm.signal.bind(sm, 'message'),
    shutdown() {
      sm.enter(terminated);
    }
  };
};
