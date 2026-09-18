module.exports = new Proxy(
  {},
  {
    get() {
      throw new Error("filesystem access is unavailable in @ooraini/pgquic");
    },
  },
);
