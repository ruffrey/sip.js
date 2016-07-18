module.exports = function clone(o, deep) {
  if (typeof o === 'object') {
    const r = Array.isArray(o) ? [] : {};
    Object.keys(o).forEach((k) => {
      r[k] = deep ? clone(o[k], deep) : o[k];
    });
    return r;
  }

  return o;
};
