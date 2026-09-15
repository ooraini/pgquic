DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'browser_user') THEN
    CREATE ROLE browser_user LOGIN PASSWORD 'development-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT CONNECT ON DATABASE app TO browser_user;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS postgis;
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

-- Live commerce demo -------------------------------------------------------
-- Every entity has a UUID primary key and a same-named notification channel.
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  segment text NOT NULL CHECK (segment IN ('New', 'Regular', 'VIP')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL UNIQUE,
  price numeric(12, 2) NOT NULL CHECK (price >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO customers (id, name, email, segment) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Maya Chen', 'maya@example.test', 'VIP'),
  ('10000000-0000-4000-8000-000000000002', 'Omar Haddad', 'omar@example.test', 'Regular'),
  ('10000000-0000-4000-8000-000000000003', 'Nora Williams', 'nora@example.test', 'New'),
  ('10000000-0000-4000-8000-000000000004', 'Leo Martin', 'leo@example.test', 'Regular'),
  ('10000000-0000-4000-8000-000000000005', 'Sara Ibrahim', 'sara@example.test', 'VIP')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, sku, price, stock) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Halo desk lamp', 'HALO-LAMP', 129.00, 18),
  ('20000000-0000-4000-8000-000000000002', 'Arc notebook', 'ARC-NOTE', 24.00, 42),
  ('20000000-0000-4000-8000-000000000003', 'Form wireless pad', 'FORM-PAD', 79.00, 7),
  ('20000000-0000-4000-8000-000000000004', 'Drift travel mug', 'DRIFT-MUG', 38.00, 25),
  ('20000000-0000-4000-8000-000000000005', 'Loop cable set', 'LOOP-CABLE', 19.00, 11),
  ('20000000-0000-4000-8000-000000000006', 'Slate laptop stand', 'SLATE-STAND', 94.00, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders (id, customer_id, product_id, quantity, total, status, created_at, updated_at) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 129.00, 'delivered', now() - interval '3 hours', now() - interval '2 hours'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 2, 158.00, 'shipped', now() - interval '80 minutes', now() - interval '30 minutes'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', 1, 38.00, 'processing', now() - interval '24 minutes', now() - interval '12 minutes'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000006', 1, 94.00, 'pending', now() - interval '4 minutes', now() - interval '4 minutes')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION notify_entity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entity_id uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  PERFORM pg_notify(TG_TABLE_NAME, entity_id::text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS customers_notify_change ON customers;
CREATE TRIGGER customers_notify_change
AFTER INSERT OR UPDATE OR DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION notify_entity_change();

DROP TRIGGER IF EXISTS products_notify_change ON products;
CREATE TRIGGER products_notify_change
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION notify_entity_change();

DROP TRIGGER IF EXISTS orders_notify_change ON orders;
CREATE TRIGGER orders_notify_change
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION notify_entity_change();

CREATE OR REPLACE FUNCTION demo_create_order() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  chosen_customer customers%ROWTYPE;
  chosen_product products%ROWTYPE;
  chosen_quantity integer;
BEGIN
  SELECT * INTO chosen_customer FROM customers ORDER BY random() LIMIT 1;
  SELECT * INTO chosen_product FROM products WHERE stock > 0 ORDER BY random() LIMIT 1;
  IF chosen_customer.id IS NULL OR chosen_product.id IS NULL THEN RETURN; END IF;
  chosen_quantity := LEAST(chosen_product.stock, 1 + floor(random() * 2)::integer);
  INSERT INTO orders (customer_id, product_id, quantity, total, status)
  VALUES (chosen_customer.id, chosen_product.id, chosen_quantity,
          chosen_product.price * chosen_quantity, 'pending');
  UPDATE products
  SET stock = stock - chosen_quantity, updated_at = now()
  WHERE id = chosen_product.id;
  UPDATE customers SET updated_at = now() WHERE id = chosen_customer.id;
  DELETE FROM orders
  WHERE id IN (
    SELECT id FROM orders ORDER BY created_at DESC OFFSET 199
  );
END
$$;

CREATE OR REPLACE FUNCTION demo_advance_order() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE chosen_id uuid;
BEGIN
  SELECT id INTO chosen_id
  FROM orders
  WHERE status <> 'delivered'
  ORDER BY created_at
  LIMIT 1;
  IF chosen_id IS NULL THEN RETURN; END IF;
  UPDATE orders
  SET status = CASE status
    WHEN 'pending' THEN 'processing'
    WHEN 'processing' THEN 'shipped'
    ELSE 'delivered'
  END,
  updated_at = now()
  WHERE id = chosen_id;
END
$$;

CREATE OR REPLACE FUNCTION demo_restock_product() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET stock = stock + 2 + floor(random() * 7)::integer, updated_at = now()
  WHERE id = (SELECT id FROM products ORDER BY stock, random() LIMIT 1);
END
$$;

GRANT SELECT ON customers, products, orders TO browser_user;

SELECT cron.schedule('commerce-new-orders', '5 seconds', 'SELECT demo_create_order()');
SELECT cron.schedule('commerce-fulfillment', '7 seconds', 'SELECT demo_advance_order()');
SELECT cron.schedule('commerce-inventory', '11 seconds', 'SELECT demo_restock_product()');

-- Vacation approval demo ---------------------------------------------------
-- Every browser persona authenticates as a real PostgreSQL login. The
-- application never supplies an employee or tenant identifier to establish
-- identity; authorization derives from session_user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vacation_employee') THEN
    CREATE ROLE vacation_employee NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vacation_manager') THEN
    CREATE ROLE vacation_manager NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vacation_hr') THEN
    CREATE ROLE vacation_hr NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ava_employee') THEN
    CREATE ROLE ava_employee LOGIN PASSWORD 'ava-vacation-demo'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'noah_employee') THEN
    CREATE ROLE noah_employee LOGIN PASSWORD 'noah-vacation-demo'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'maya_manager') THEN
    CREATE ROLE maya_manager LOGIN PASSWORD 'maya-vacation-demo'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finn_hr') THEN
    CREATE ROLE finn_hr LOGIN PASSWORD 'finn-vacation-demo'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT vacation_employee TO ava_employee, noah_employee;
GRANT vacation_manager TO maya_manager;
GRANT vacation_hr TO finn_hr;
GRANT CONNECT ON DATABASE app TO ava_employee, noah_employee, maya_manager, finn_hr;

CREATE SCHEMA IF NOT EXISTS vacation;
REVOKE ALL ON SCHEMA vacation FROM PUBLIC;
GRANT USAGE ON SCHEMA vacation
  TO vacation_employee, vacation_manager, vacation_hr;

CREATE TABLE IF NOT EXISTS vacation.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_role name NOT NULL UNIQUE,
  display_name text NOT NULL,
  title text NOT NULL,
  manager_id uuid REFERENCES vacation.employees(id),
  allowance_days integer NOT NULL CHECK (allowance_days BETWEEN 0 AND 60)
);

CREATE TABLE IF NOT EXISTS vacation.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES vacation.employees(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 240),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  manager_note text CHECK (manager_note IS NULL OR length(manager_note) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (ends_on - starts_on <= 30)
);

CREATE TABLE IF NOT EXISTS vacation.request_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES vacation.requests(id),
  actor name NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO vacation.employees
  (id, database_role, display_name, title, manager_id, allowance_days)
VALUES
  ('51000000-0000-4000-8000-000000000003', 'maya_manager', 'Maya Chen', 'Engineering manager', NULL, 30),
  ('51000000-0000-4000-8000-000000000004', 'finn_hr', 'Finn Walsh', 'People operations', NULL, 30)
ON CONFLICT (id) DO UPDATE SET
  database_role = EXCLUDED.database_role,
  display_name = EXCLUDED.display_name,
  title = EXCLUDED.title,
  manager_id = EXCLUDED.manager_id,
  allowance_days = EXCLUDED.allowance_days;

INSERT INTO vacation.employees
  (id, database_role, display_name, title, manager_id, allowance_days)
VALUES
  ('51000000-0000-4000-8000-000000000001', 'ava_employee', 'Ava Rahman', 'Product designer', '51000000-0000-4000-8000-000000000003', 24),
  ('51000000-0000-4000-8000-000000000002', 'noah_employee', 'Noah Williams', 'Platform engineer', '51000000-0000-4000-8000-000000000003', 24)
ON CONFLICT (id) DO UPDATE SET
  database_role = EXCLUDED.database_role,
  display_name = EXCLUDED.display_name,
  title = EXCLUDED.title,
  manager_id = EXCLUDED.manager_id,
  allowance_days = EXCLUDED.allowance_days;

INSERT INTO vacation.requests
  (id, employee_id, starts_on, ends_on, reason, status, manager_note, created_at, updated_at)
VALUES
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', current_date + 18, current_date + 22, 'Family trip to the coast', 'submitted', NULL, now() - interval '2 days', now() - interval '2 days'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', current_date + 7, current_date + 8, 'A quiet long weekend', 'approved', 'Enjoy the break.', now() - interval '8 days', now() - interval '7 days'),
  ('52000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', current_date + 40, current_date + 44, 'Visiting family abroad', 'draft', NULL, now() - interval '1 day', now() - interval '1 day'),
  ('52000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000003', current_date + 28, current_date + 30, 'Desert retreat', 'approved', 'Approved by People Ops.', now() - interval '12 days', now() - interval '11 days')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION vacation.actor_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
  SELECT id FROM vacation.employees WHERE database_role = session_user
$$;

CREATE OR REPLACE FUNCTION vacation.can_see_request(target_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
  SELECT
    target_employee = vacation.actor_employee_id()
    OR EXISTS (
      SELECT 1 FROM vacation.employees
      WHERE id = target_employee
        AND manager_id = vacation.actor_employee_id()
    )
    OR pg_has_role(session_user, 'vacation_hr', 'member')
$$;

ALTER TABLE vacation.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation.requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS requests_visible_to_actor ON vacation.requests;
CREATE POLICY requests_visible_to_actor ON vacation.requests
FOR SELECT USING (vacation.can_see_request(employee_id));

ALTER TABLE vacation.request_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation.request_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_visible_to_actor ON vacation.request_audit;
CREATE POLICY audit_visible_to_actor ON vacation.request_audit
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM vacation.requests r
    WHERE r.id = request_id
  )
);

CREATE OR REPLACE FUNCTION vacation.audit_request_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
DECLARE action_name text;
BEGIN
  action_name := CASE
    WHEN TG_OP = 'INSERT' THEN 'created'
    WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status
    ELSE 'updated'
  END;
  INSERT INTO vacation.request_audit
    (request_id, actor, action, from_status, to_status)
  VALUES
    (NEW.id, session_user, action_name,
     CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
  PERFORM pg_notify('vacation_requests', NEW.id::text);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS vacation_request_changed ON vacation.requests;
CREATE TRIGGER vacation_request_changed
AFTER INSERT OR UPDATE ON vacation.requests
FOR EACH ROW EXECUTE FUNCTION vacation.audit_request_change();

CREATE OR REPLACE FUNCTION vacation.current_profile()
RETURNS TABLE (
  id uuid, display_name text, title text, persona text,
  allowance_days integer, visible_requests bigint
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
  SELECT e.id, e.display_name, e.title,
    CASE
      WHEN pg_has_role(session_user, 'vacation_hr', 'member') THEN 'hr'
      WHEN pg_has_role(session_user, 'vacation_manager', 'member') THEN 'manager'
      ELSE 'employee'
    END,
    e.allowance_days,
    (SELECT count(*) FROM vacation.requests r
      WHERE vacation.can_see_request(r.employee_id))
  FROM vacation.employees e
  WHERE e.database_role = session_user
$$;

CREATE OR REPLACE FUNCTION vacation.create_request(
  requested_start date, requested_end date, requested_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
DECLARE actor_id uuid := vacation.actor_employee_id();
DECLARE created_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT pg_has_role(session_user, 'vacation_employee', 'member') THEN
    RAISE EXCEPTION 'only employees can create vacation requests' USING ERRCODE = '42501';
  END IF;
  IF requested_start < current_date THEN
    RAISE EXCEPTION 'vacation cannot start in the past' USING ERRCODE = '22007';
  END IF;
  IF requested_end < requested_start OR requested_end - requested_start > 30 THEN
    RAISE EXCEPTION 'vacation must be between 1 and 31 calendar days' USING ERRCODE = '22007';
  END IF;
  IF length(trim(requested_reason)) NOT BETWEEN 3 AND 240 THEN
    RAISE EXCEPTION 'reason must contain between 3 and 240 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vacation.requests
    WHERE employee_id = actor_id
      AND status IN ('submitted', 'approved')
      AND daterange(starts_on, ends_on, '[]') && daterange(requested_start, requested_end, '[]')
  ) THEN
    RAISE EXCEPTION 'these dates overlap another active request';
  END IF;
  INSERT INTO vacation.requests (employee_id, starts_on, ends_on, reason)
  VALUES (actor_id, requested_start, requested_end, trim(requested_reason))
  RETURNING id INTO created_id;
  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION vacation.submit_request(requested_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
BEGIN
  UPDATE vacation.requests SET status = 'submitted', updated_at = now()
  WHERE id = requested_id
    AND employee_id = vacation.actor_employee_id()
    AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only your own draft can be submitted' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION vacation.cancel_request(requested_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
BEGIN
  UPDATE vacation.requests SET status = 'cancelled', updated_at = now()
  WHERE id = requested_id
    AND employee_id = vacation.actor_employee_id()
    AND status IN ('draft', 'submitted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only your own draft or submitted request can be cancelled' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION vacation.decide_request(
  requested_id uuid, decision text, note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vacation, pg_temp AS $$
BEGIN
  IF NOT pg_has_role(session_user, 'vacation_manager', 'member') THEN
    RAISE EXCEPTION 'only managers can decide requests' USING ERRCODE = '42501';
  END IF;
  IF decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;
  UPDATE vacation.requests r
  SET status = decision, manager_note = nullif(trim(note), ''), updated_at = now()
  FROM vacation.employees e
  WHERE r.id = requested_id
    AND r.employee_id = e.id
    AND e.manager_id = vacation.actor_employee_id()
    AND r.status = 'submitted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only a direct report submitted request can be decided' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA vacation FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vacation FROM PUBLIC;
GRANT SELECT ON vacation.employees, vacation.requests, vacation.request_audit
  TO vacation_employee, vacation_manager, vacation_hr;
GRANT EXECUTE ON FUNCTION vacation.actor_employee_id(), vacation.can_see_request(uuid), vacation.current_profile()
  TO vacation_employee, vacation_manager, vacation_hr;
GRANT EXECUTE ON FUNCTION vacation.create_request(date, date, text), vacation.submit_request(uuid), vacation.cancel_request(uuid)
  TO vacation_employee;
GRANT EXECUTE ON FUNCTION vacation.decide_request(uuid, text, text)
  TO vacation_manager;
