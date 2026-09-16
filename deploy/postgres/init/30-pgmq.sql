-- Fresh clusters run the image's 00-pgmq.sql first. The explicit guard also
-- upgrades an existing demo volume that predates the SQL-only PGMQ install.
SELECT to_regnamespace('pgmq') IS NULL AS install_pgmq \gset
\if :install_pgmq
\i /docker-entrypoint-initdb.d/00-pgmq.sql
\endif

-- PGMQ observatory demo ----------------------------------------------------
-- PGMQ itself is installed from its pinned SQL distribution by the image's
-- 00-pgmq.sql initializer. These helpers only provide safe, non-destructive
-- inspection across PGMQ's per-queue tables for the browser demo.
GRANT USAGE ON SCHEMA pgmq TO browser_user;
GRANT SELECT ON ALL TABLES IN SCHEMA pgmq TO browser_user;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA pgmq TO browser_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO browser_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT SELECT ON TABLES TO browser_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT SELECT ON SEQUENCES TO browser_user;

SELECT pgmq.create('order_events');
SELECT pgmq.create('email_delivery');
SELECT pgmq.create('webhooks');

-- Seed both live and archived messages so every observatory panel has useful
-- state on first load. The guards make this safe to rerun against demo volumes.
DO $$
DECLARE
  archived_id bigint;
BEGIN
  IF NOT EXISTS (SELECT FROM pgmq.q_order_events)
     AND NOT EXISTS (SELECT FROM pgmq.a_order_events) THEN
    SELECT * INTO archived_id FROM pgmq.send(
      'order_events',
      '{"event":"order.created","order_id":"ORD-1041","total":149.00}'::jsonb,
      '{"content-type":"application/json","trace-id":"tr_7fa1","priority":"normal"}'::jsonb
    );
    PERFORM pgmq.archive('order_events', archived_id);
    PERFORM pgmq.send(
      'order_events',
      '{"event":"order.paid","order_id":"ORD-1042","total":84.50}'::jsonb,
      '{"content-type":"application/json","trace-id":"tr_80b2","priority":"high"}'::jsonb
    );
    PERFORM pgmq.send(
      'order_events',
      '{"event":"order.ready","order_id":"ORD-1043","warehouse":"ruh-1"}'::jsonb,
      '{"content-type":"application/json","trace-id":"tr_91c3","priority":"normal"}'::jsonb
    );
  END IF;

  IF NOT EXISTS (SELECT FROM pgmq.q_email_delivery)
     AND NOT EXISTS (SELECT FROM pgmq.a_email_delivery) THEN
    SELECT * INTO archived_id FROM pgmq.send(
      'email_delivery',
      '{"template":"welcome","to":"maya@example.test","locale":"en"}'::jsonb,
      '{"provider":"resend","campaign":"onboarding","attempt":"1"}'::jsonb
    );
    PERFORM pgmq.archive('email_delivery', archived_id);
    PERFORM pgmq.send(
      'email_delivery',
      '{"template":"receipt","to":"omar@example.test","order_id":"ORD-1042"}'::jsonb,
      '{"provider":"resend","campaign":"transactional","attempt":"1"}'::jsonb
    );
  END IF;

  IF NOT EXISTS (SELECT FROM pgmq.q_webhooks)
     AND NOT EXISTS (SELECT FROM pgmq.a_webhooks) THEN
    SELECT * INTO archived_id FROM pgmq.send(
      'webhooks',
      '{"endpoint":"https://example.test/hooks/orders","event":"order.created"}'::jsonb,
      '{"x-signature-version":"v1","trace-id":"tr_7fa1","attempt":"1"}'::jsonb
    );
    PERFORM pgmq.archive('webhooks', archived_id);
    PERFORM pgmq.send(
      'webhooks',
      '{"endpoint":"https://example.test/hooks/inventory","event":"stock.low"}'::jsonb,
      '{"x-signature-version":"v1","trace-id":"tr_a2d4","attempt":"2"}'::jsonb
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.demo_pgmq_queue_heads()
RETURNS TABLE (
  queue_name text,
  archive_count bigint,
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  last_read_at timestamptz,
  vt timestamptz,
  message jsonb,
  headers jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pgmq
AS $$
DECLARE
  queue record;
  queue_table text;
  archive_table text;
BEGIN
  -- PGMQ stores each queue in its own physical tables. %I quotes the derived
  -- identifiers, while USING keeps the queue name itself a bound value.
  FOR queue IN SELECT meta.queue_name FROM pgmq.meta ORDER BY meta.queue_name LOOP
    queue_table := pgmq.format_table_name(queue.queue_name, 'q');
    archive_table := pgmq.format_table_name(queue.queue_name, 'a');
    RETURN QUERY EXECUTE format(
      'SELECT $1::text, (SELECT count(*) FROM pgmq.%1$I),
              head.msg_id, head.read_ct, head.enqueued_at,
              head.last_read_at, head.vt, head.message, head.headers
         FROM (VALUES (true)) AS seed(present)
         LEFT JOIN LATERAL (
           SELECT q.msg_id, q.read_ct, q.enqueued_at, q.last_read_at,
                  q.vt, q.message, q.headers
             FROM pgmq.%2$I q
            ORDER BY q.msg_id
            LIMIT 1
         ) head ON seed.present',
      archive_table,
      queue_table
    ) USING queue.queue_name;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.demo_pgmq_archives(result_limit integer DEFAULT 200)
RETURNS TABLE (
  queue_name text,
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  last_read_at timestamptz,
  archived_at timestamptz,
  vt timestamptz,
  message jsonb,
  headers jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pgmq
AS $$
DECLARE
  queue record;
  archive_table text;
BEGIN
  FOR queue IN SELECT meta.queue_name FROM pgmq.meta LOOP
    archive_table := pgmq.format_table_name(queue.queue_name, 'a');
    RETURN QUERY EXECUTE format(
      'SELECT $1::text, a.msg_id, a.read_ct, a.enqueued_at,
              a.last_read_at, a.archived_at, a.vt, a.message, a.headers
         FROM pgmq.%I a
        ORDER BY a.archived_at DESC
        LIMIT $2',
      archive_table
    ) USING queue.queue_name, greatest(1, least(result_limit, 500));
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.demo_pgmq_messages(
  selected_queue text,
  result_limit integer DEFAULT 200
)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  last_read_at timestamptz,
  vt timestamptz,
  message jsonb,
  headers jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pgmq
AS $$
DECLARE
  queue_table text;
BEGIN
  -- Validate against PGMQ metadata before deriving a dynamic table identifier.
  IF NOT EXISTS (
    SELECT FROM pgmq.meta WHERE meta.queue_name = selected_queue
  ) THEN
    RAISE EXCEPTION 'PGMQ queue does not exist: %', selected_queue;
  END IF;

  queue_table := pgmq.format_table_name(selected_queue, 'q');
  RETURN QUERY EXECUTE format(
    'SELECT q.msg_id, q.read_ct, q.enqueued_at, q.last_read_at,
            q.vt, q.message, q.headers
       FROM pgmq.%I q
      ORDER BY q.msg_id
      LIMIT $1',
    queue_table
  ) USING greatest(1, least(result_limit, 500));
END
$$;

CREATE OR REPLACE FUNCTION public.demo_pgmq_archive(
  selected_queue text,
  selected_message_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pgmq
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pgmq.meta WHERE meta.queue_name = selected_queue
  ) THEN
    RAISE EXCEPTION 'PGMQ queue does not exist: %', selected_queue;
  END IF;
  RETURN pgmq.archive(selected_queue, selected_message_id);
END
$$;

CREATE OR REPLACE FUNCTION public.demo_pgmq_delete(
  selected_queue text,
  selected_message_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pgmq
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pgmq.meta WHERE meta.queue_name = selected_queue
  ) THEN
    RAISE EXCEPTION 'PGMQ queue does not exist: %', selected_queue;
  END IF;
  RETURN pgmq.delete(selected_queue, selected_message_id);
END
$$;

-- SECURITY DEFINER helpers are closed to PUBLIC, then exposed explicitly to
-- the read-mostly browser role as the demo's narrow database API.
REVOKE ALL ON FUNCTION public.demo_pgmq_queue_heads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_pgmq_archives(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_pgmq_messages(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_pgmq_archive(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_pgmq_delete(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demo_pgmq_queue_heads() TO browser_user;
GRANT EXECUTE ON FUNCTION public.demo_pgmq_archives(integer) TO browser_user;
GRANT EXECUTE ON FUNCTION public.demo_pgmq_messages(text, integer) TO browser_user;
GRANT EXECUTE ON FUNCTION public.demo_pgmq_archive(text, bigint) TO browser_user;
GRANT EXECUTE ON FUNCTION public.demo_pgmq_delete(text, bigint) TO browser_user;
