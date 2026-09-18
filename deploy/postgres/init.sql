\set ON_ERROR_STOP on

-- Each demo owns its schema, seed data, grants, and helper functions in a
-- separately runnable script. This file only preserves one ordered entry point.
\ir init/00-common.sql
\ir init/10-dashboard.sql
\ir init/20-pg-cron.sql
\ir init/30-pgmq.sql
\ir init/40-commerce.sql
\ir init/50-security.sql
\ir init/60-ops.sql
