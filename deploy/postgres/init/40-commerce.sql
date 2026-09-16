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
  -- Publish only the stable row id. Browsers treat NOTIFY as invalidation and
  -- query the table again instead of trusting a lossy event as source of truth.
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
  -- This small workload changes several tables in one transaction, producing
  -- the notification bursts that the live-query UI coalesces.
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

-- The browser observes this workload but cannot mutate the commerce tables.
GRANT SELECT ON customers, products, orders TO browser_user;

-- Named schedules are updated rather than duplicated when initialization is
-- rerun, keeping an existing development volume deterministic.
SELECT cron.schedule('commerce-new-orders', '5 seconds', 'SELECT demo_create_order()');
SELECT cron.schedule('commerce-fulfillment', '7 seconds', 'SELECT demo_advance_order()');
SELECT cron.schedule('commerce-inventory', '11 seconds', 'SELECT demo_restock_product()');
