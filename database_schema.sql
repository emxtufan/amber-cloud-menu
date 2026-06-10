-- =========================================================================
-- RESTAURANT QR ORDERING SYSTEM - SUPABASE POSTGRESQL PRODUCTION DURATION SCHEMA
-- =========================================================================

-- Enable Extension for UUID codes if not loaded
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. ENUMS & DOMAINS
-- ==========================================
CREATE TYPE order_status AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');
CREATE TYPE table_status AS ENUM ('AVAILABLE', 'WAITING', 'PREPARING', 'READY', 'NEEDS_BILL');
CREATE TYPE bill_status AS ENUM ('BILL_REQUESTED', 'BILL_SENT', 'PAID');
CREATE TYPE payment_method AS ENUM ('CASH', 'CARD');
CREATE TYPE user_role AS ENUM ('CUSTOMER', 'KITCHEN', 'WAITER', 'ADMIN');

-- ==========================================
-- 2. USER PROFILES
-- ==========================================
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role user_role DEFAULT 'CUSTOMER' NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 3. TABLES (PHYSICAL FLOOR PLAN)
-- ==========================================
CREATE TABLE tables (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  number INTEGER UNIQUE NOT NULL CONSTRAINT positive_table_number CHECK (number > 0),
  status table_status DEFAULT 'AVAILABLE' NOT NULL,
  active_session_id TEXT,
  name TEXT, 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 4. MENU CATEGORIES
-- ==========================================
CREATE TABLE categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '🍕' NOT NULL, -- Emoji or Lucide slug
  slug TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 5. PRODUCTS (ITEMS)
-- ==========================================
CREATE TABLE products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL CONSTRAINT positive_price CHECK (price >= 0),
  image_url TEXT NOT NULL,
  rating DECIMAL(3,2) DEFAULT 5.0 CONSTRAINT rating_bounds CHECK (rating >= 1.0 AND rating <= 5.0),
  reviews_count INTEGER DEFAULT 0 CONSTRAINT positive_rec_count CHECK (reviews_count >= 0),
  prep_time INTEGER NOT NULL CONSTRAINT positive_prep_time CHECK (prep_time > 0), -- inside minutes
  is_bestseller BOOLEAN DEFAULT FALSE NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT NOT NULL,
  available BOOLEAN DEFAULT TRUE NOT NULL,
  allergens TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 6. INGREDIENTS SCHEMA
-- ==========================================
CREATE TABLE ingredients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT -- Emoji icon representation (optional)
);

CREATE TABLE product_ingredients (
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, ingredient_id)
);

-- ==========================================
-- 7. ORDERS SYSTEM
-- ==========================================
CREATE TABLE orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  table_id UUID REFERENCES tables(id) ON DELETE RESTRICT NOT NULL,
  order_number VARCHAR(12) UNIQUE NOT NULL, -- e.g. "ORD-4819"
  status order_status DEFAULT 'PENDING' NOT NULL,
  notes TEXT,
  subtotal DECIMAL(10, 2) DEFAULT 0.0 NOT NULL,
  prep_time_estimate INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 8. ORDER ITEMS (LINE ASSEMBLY)
-- ==========================================
CREATE TABLE order_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT NOT NULL,
  product_name TEXT NOT NULL, -- Snapshot of item names at order execution
  price DECIMAL(10, 2) NOT NULL, -- Snapshot of ticket costs at checkout 
  quantity INTEGER DEFAULT 1 NOT NULL CONSTRAINT positive_qty CHECK (quantity > 0),
  notes TEXT
);

-- ==========================================
-- 9. SERVICE REVIEWS
-- ==========================================
CREATE TABLE reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT,
  rating INTEGER NOT NULL CONSTRAINT raw_ratings CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  customer_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 10. BILLING & INVOICING
-- ==========================================
CREATE TABLE bills (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  table_id UUID REFERENCES tables(id) ON DELETE RESTRICT NOT NULL,
  order_ids UUID[] NOT NULL,
  status bill_status DEFAULT 'BILL_REQUESTED' NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  payment_method payment_method NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ==========================================
-- 11. INDEXES FOR EXTREME RUNTIME QUERY PERFORMANCE
-- ==========================================
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_table ON orders(table_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_main ON order_items(order_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_bills_table ON bills(table_id);

-- ==========================================
-- 12. DATABASE CONCURRENCY TRIGGER FUNCTIONS
-- ==========================================

-- Trigger to auto-update modification timestamps
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_modtime BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_products_modtime BEFORE UPDATE ON products FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_orders_modtime BEFORE UPDATE ON orders FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_bills_modtime BEFORE UPDATE ON bills FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ==========================================
-- 13. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

-- 13a. Categorization and Menu: Customer Public Read
CREATE POLICY "Public read menus" ON categories FOR SELECT USING (active = true);
CREATE POLICY "Public read products" ON products FOR SELECT USING (available = true);
CREATE POLICY "Public read ingredients" ON ingredients FOR SELECT USING (true);
CREATE POLICY "Public read mapping" ON product_ingredients FOR SELECT USING (true);

-- 13b. Ordering system: Customers insertion, update and read theirs
CREATE POLICY "Diners can create order items" ON order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Diners can create orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Diners can fetch active orders" ON orders FOR SELECT USING (true);
CREATE POLICY "Diners can view ordering details" ON order_items FOR SELECT USING (true);
CREATE POLICY "Diners can make feedback reviews" ON reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Diners can browse reviews" ON reviews FOR SELECT USING (true);

-- 13c. Bills: Public Table Requests
CREATE POLICY "Public bill request" ON bills FOR INSERT WITH CHECK (true);
CREATE POLICY "Public bill tracking" ON bills FOR SELECT USING (true);

-- 13d. Private Back-Office overrides (Staff Admin / Kitchen / Waiter roles)
CREATE POLICY "Kitchen-Waiter-Admin CRUD control categories" ON categories FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('ADMIN')));

CREATE POLICY "Admin CRUD control products" ON products FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('ADMIN')));

CREATE POLICY "Staff CRUD tables floor" ON tables FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('WAITER', 'ADMIN')));

CREATE POLICY "Staff update orders status" ON orders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('KITCHEN', 'WAITER', 'ADMIN')));

CREATE POLICY "Staff process billing pipelines" ON bills FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('WAITER', 'ADMIN')));
