-- Read-only role for the PostgreSQL operations dashboard. pg_monitor exposes
-- server statistics and other sessions' query text without granting write or
-- schema privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ops_monitor') THEN
    CREATE ROLE ops_monitor LOGIN PASSWORD 'development-monitor-only'
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE ops_monitor INHERIT;
GRANT CONNECT ON DATABASE app TO ops_monitor;
GRANT pg_monitor TO ops_monitor;
