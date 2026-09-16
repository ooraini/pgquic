-- pg_cron must be preloaded by PostgreSQL (see docker-compose.yml). PostGIS is
-- included so scheduled jobs can also exercise an installed extension.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Grant the dashboard only the catalog access and management functions it
-- demonstrates; it does not receive arbitrary privileges on the cron schema.
GRANT USAGE ON SCHEMA cron TO browser_user;
GRANT SELECT ON cron.job, cron.job_run_details TO browser_user;
GRANT DELETE ON cron.job_run_details TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.schedule_in_database(text, text, text, text, text, boolean) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.alter_job(bigint, text, text, text, text, boolean) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.unschedule(bigint) TO browser_user;
GRANT EXECUTE ON FUNCTION cron.unschedule(text) TO browser_user;
