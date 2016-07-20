const MAGIC_COOKIE = 'z9hG4bK';

/**
 * For generating a new SIP branch tag field.
 * @return {String}
 */
module.exports = function generateBranch() {
  return [MAGIC_COOKIE, Math.round(Math.random() * 1000000)].join('');
};
