module.exports = new Proxy(
  {},
  {
    get() {
      throw new Error("filesystem access is unavailable in @pgquic/client");
    },
  },
);
