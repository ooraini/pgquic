-- A deliberately tiny relation for the protocol dashboard's parameterized and
-- prepared-query examples; the browser role remains read-only.
CREATE TABLE IF NOT EXISTS posts (id integer PRIMARY KEY, title text NOT NULL);
INSERT INTO posts VALUES (1, 'Hello from PostgreSQL'), (123, 'Multiplexed over QUIC') ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON posts TO browser_user;
