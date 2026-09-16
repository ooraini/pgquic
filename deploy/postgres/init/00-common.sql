-- Shared login for demos that focus on transport behavior rather than database
-- authorization. It can connect, but receives object privileges per demo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'browser_user') THEN
    CREATE ROLE browser_user LOGIN PASSWORD 'development-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT CONNECT ON DATABASE app TO browser_user;
