CREATE ROLE browser_user LOGIN PASSWORD 'development-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE app TO browser_user;
CREATE TABLE posts (id integer PRIMARY KEY, title text NOT NULL);
INSERT INTO posts VALUES (1, 'Hello from PostgreSQL'), (123, 'Multiplexed over QUIC');
GRANT SELECT ON posts TO browser_user;
