/**
 * Factory method, which returns a base state machine.
 */
module.exports = function makeSM() {
  let state;

  return {
    enter(newstate) {
      if (state && state.leave) {
        state.leave();
      }

      state = newstate;

      Array.prototype.shift.apply(arguments);

      if (state.enter) {
        state.enter.apply(this, arguments);
      }
    },
    signal(s) {
      if (state && state[s]) {
        state[Array.prototype.shift.apply(arguments)].apply(state, arguments);
      }
    }
  };
};
