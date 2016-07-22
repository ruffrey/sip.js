const parseSIPMessage = require('./messageHelpers').parseSIPMessage;

module.exports = function makeStreamParser(onMessage) {
  let m;
  let r = '';

  function headers(data) {
    r += data;
    const a = r.match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);

    if (a) {
      r = a[2];
      m = parseSIPMessage(a[1]);

      if (m && m.headers['content-length'] !== undefined) {
        state = content;
        content('');
      }
    }
  }

  function content(data) {
    r += data;

    if (r.length >= m.headers['content-length']) {
      m.content = r.substring(0, m.headers['content-length']);

      onMessage(m);

      const s = r.substring(m.headers['content-length']);
      state = headers;
      r = '';
      headers(s);
    }
  }

  let state = headers;

  return (data) => state(data);
};
