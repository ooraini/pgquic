module.exports = {
  lookup(_host, callback) {
    callback(new Error("DNS lookup is unavailable in the browser"));
  },
};
