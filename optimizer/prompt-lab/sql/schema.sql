-- prompt-lab text-to-SQL fixture: small self-contained SQLite store.
-- ponytail: hand-seeded mini-schema, no external dataset. Swap Spider-dev /
-- Defog sql-eval behind questions.json if more coverage is needed.

CREATE TABLE customers (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  city    TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE products (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  price    REAL NOT NULL
);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date  TEXT NOT NULL            -- 'YYYY-MM-DD'
);

CREATE TABLE order_items (
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL
);

INSERT INTO customers (id, name, city, country) VALUES
  (1, 'Alice',  'London',     'UK'),
  (2, 'Bob',    'Manchester', 'UK'),
  (3, 'Carlos', 'Madrid',     'Spain'),
  (4, 'Diana',  'Berlin',     'Germany'),
  (5, 'Eve',    'London',     'UK');     -- no orders (for the no-orders question)

INSERT INTO products (id, name, category, price) VALUES
  (1, 'Widget',   'Hardware',    10.0),
  (2, 'Gadget',   'Hardware',    25.0),
  (3, 'Manual',   'Books',        5.0),
  (4, 'Cable',    'Hardware',     3.0),
  (5, 'Notebook', 'Books',        8.0),
  (6, 'Mouse',    'Electronics', 15.0);

INSERT INTO orders (id, customer_id, order_date) VALUES
  (1, 1, '2024-01-15'),
  (2, 1, '2024-02-20'),
  (3, 2, '2024-01-10'),
  (4, 3, '2024-03-05'),
  (5, 4, '2024-03-15'),
  (6, 2, '2024-02-01');

INSERT INTO order_items (order_id, product_id, qty) VALUES
  (1, 1, 2), (1, 3, 1),
  (2, 2, 1), (2, 6, 1),
  (3, 1, 5),
  (4, 4, 10), (4, 5, 2),
  (5, 2, 3),
  (6, 6, 2), (6, 3, 4);
