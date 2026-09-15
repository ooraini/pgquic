module.exports = {
  webcrypto: globalThis.crypto,
  createHash() {
    throw new Error("Node crypto is unavailable in browsers");
  },
};
