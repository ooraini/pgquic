module.exports = {
  isIP() {
    return 0;
  },
  Socket: class {
    constructor() {
      throw new Error("net is unavailable; configure PgWebTransport");
    }
  },
};
