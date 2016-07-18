const MAGIC_COOKIE = 'z9hG4bK';

module.exports = function generateBranch() {
  return [MAGIC_COOKIE, Math.round(Math.random() * 1000000)].join('');
};
