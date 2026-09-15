DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'browser_user') THEN
    CREATE ROLE browser_user LOGIN PASSWORD 'development-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT CONNECT ON DATABASE app TO browser_user;
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO browser_user;
GRANT SELECT ON cron.job, cron.job_run_details TO browser_user;
GRANT DELETE ON cron.job_run_details TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule_in_database(text, text, text, text, text, boolean) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.alter_job(bigint, text, text, text, text, boolean) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.unschedule(bigint) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.unschedule(text) TO browser_user;
CREATE TABLE IF NOT EXISTS posts (id integer PRIMARY KEY, title text NOT NULL);
INSERT INTO posts VALUES (1, 'Hello from PostgreSQL'), (123, 'Multiplexed over QUIC') ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON posts TO browser_user;
