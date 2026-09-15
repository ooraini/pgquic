module.exports = {
  connect() {
    throw new Error("PostgreSQL TLS is unavailable; use ssl: false");
  },
};
