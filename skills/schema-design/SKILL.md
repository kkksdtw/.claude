---
name: schema-design
description: "DB 스키마 설계 패턴 — PK 전략, 타입 선택, 네이밍, FK, nullable, timestamp, 관계(1:N·N:M·1:1·self), 정규화와 비정규화 기준, enum·status, 인덱스 계획, anti-pattern. 테이블을 새로 설계하거나 스키마·마이그레이션을 수정·리뷰할 때 사용한다."
---

# Schema Design

## Schema Design Patterns

### 1. Primary Key Strategy

```typescript
// BEST: Auto-increment bigint (default, recommended)
id: bigint('id').primaryKey().autoincrement(),

// GOOD: UUID for distributed systems (use v7 for time-ordering)
id: uuid('id').primaryKey().defaultRandom(),

// AVOID: int for IDs (overflow at 2.1B rows)
id: int('id').primaryKey().autoincrement(), // Will overflow!

// AVOID: Random UUIDs cause index fragmentation
id: uuid('id').primaryKey(), // v4 UUIDs fragment B-tree indexes
```

### 2. Data Type Selection

```typescript
// BAD: Poor type choices
const users = table('users', {
  id: int('id'),                    // Overflows at 2.1B
  email: varchar('email', 255),     // Arbitrary limit
  isActive: varchar('is_active', 5), // Should be boolean
  balance: float('balance'),        // Precision loss for money
});

// GOOD: Proper types
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  email: varchar('email', 255).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  balance: decimal('balance', 10, 2).default('0.00'),
});
```

### 3. Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Table | snake_case, plural | `users`, `order_items` |
| Column | snake_case | `first_name`, `created_at` |
| Primary Key | `id` | `id` |
| Foreign Key | `{singular_table}_id` | `user_id`, `order_id` |
| Junction Table | `{table1}_{table2}` | `user_roles`, `product_categories` |
| Index | `{table}_{columns}_idx` | `users_email_idx` |
| Unique Constraint | `{table}_{columns}_unique` | `users_email_unique` |

```typescript
// BAD: Inconsistent naming
const Users = table('Users', {           // PascalCase table
  UserId: bigint('UserId'),              // PascalCase column
  first_name: varchar('first_name', 50), // snake_case
  lastName: varchar('lastName', 50),     // camelCase
});

// GOOD: Consistent snake_case
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  first_name: varchar('first_name', 50).notNull(),
  last_name: varchar('last_name', 50).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
```

### 4. Foreign Key Design

```typescript
// BAD: Missing foreign key constraint
const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  user_id: bigint('user_id'), // No FK constraint - allows orphan records!
});

// GOOD: Proper foreign key with cascade
const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  user_id: bigint('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

// GOOD: Foreign key with restrict (prevent accidental deletion)
const order_items = table('order_items', {
  id: bigint('id').primaryKey().autoincrement(),
  order_id: bigint('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  product_id: bigint('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
});
```

**Cascade Behavior Guide:**

| Scenario | ON DELETE | ON UPDATE |
|----------|-----------|-----------|
| Child owns parent lifecycle | CASCADE | CASCADE |
| Prevent orphan references | RESTRICT | CASCADE |
| Keep history after deletion | SET NULL | CASCADE |
| Audit/log tables | NO ACTION | NO ACTION |

### 5. Nullable vs Required Fields

```typescript
// BAD: Everything nullable by default
const products = table('products', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100),           // Can be null - bad for required field!
  price: decimal('price', 10, 2),       // Can be null - bad for required field!
  description: text('description'),     // OK - optional field
});

// GOOD: Explicit nullability
const products = table('products', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
  price: decimal('price', 10, 2).notNull(),
  description: text('description'),     // Optional - nullable is fine
  deleted_at: timestamp('deleted_at'),  // Soft delete - nullable is correct
});
```

**Nullability Rules:**
- **Required fields**: Business-critical data → `.notNull()`
- **Optional fields**: Can be empty → nullable (default)
- **Soft deletes**: `deleted_at` → nullable
- **Audit fields**: `created_at` → `.notNull()`, `updated_at` → typically `.notNull()`

### 6. Timestamp Conventions

```typescript
// GOOD: Standard timestamp pattern
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  // ... other fields
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// GOOD: Soft delete pattern
const products = table('products', {
  id: bigint('id').primaryKey().autoincrement(),
  // ... other fields
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  deleted_at: timestamp('deleted_at'), // null = not deleted
});
```

---

## Relationship Patterns

### 1. One-to-Many (1:N)

```typescript
// User has many Orders
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
});

const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  user_id: bigint('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  total_amount: decimal('total_amount', 10, 2).notNull(),
});
```

### 2. Many-to-Many (N:M)

```typescript
// Products <-> Categories (Many-to-Many)
const products = table('products', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
});

const categories = table('categories', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 50).notNull(),
});

// Junction table with composite primary key
const product_categories = table('product_categories', {
  product_id: bigint('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  category_id: bigint('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.product_id, t.category_id] }),
}));
```

### 3. One-to-One (1:1)

```typescript
// User <-> UserProfile (One-to-One)
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  email: varchar('email', 255).notNull().unique(),
});

const user_profiles = table('user_profiles', {
  id: bigint('id').primaryKey().autoincrement(),
  user_id: bigint('user_id')
    .notNull()
    .unique()  // UNIQUE ensures 1:1 relationship
    .references(() => users.id, { onDelete: 'cascade' }),
  bio: text('bio'),
  avatar_url: varchar('avatar_url', 500),
});
```

### 4. Self-Referencing Relationship

```typescript
// Categories with parent-child hierarchy
const categories = table('categories', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 50).notNull(),
  parent_id: bigint('parent_id')
    .references(() => categories.id, { onDelete: 'set null' }),
});
```

---

## Normalization Guidelines

### First Normal Form (1NF)

**Rule**: No repeating groups or arrays in columns.

```typescript
// BAD: Repeating columns
const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  product_1: varchar('product_1', 100),
  product_2: varchar('product_2', 100),
  product_3: varchar('product_3', 100),
});

// GOOD: Separate table for repeating data
const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

const order_items = table('order_items', {
  id: bigint('id').primaryKey().autoincrement(),
  order_id: bigint('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  product_name: varchar('product_name', 100).notNull(),
  quantity: int('quantity').notNull(),
});
```

### Second Normal Form (2NF)

**Rule**: No partial dependencies on composite keys.

```typescript
// BAD: product_name depends only on product_id, not full key
const order_items = table('order_items', {
  order_id: bigint('order_id').notNull(),
  product_id: bigint('product_id').notNull(),
  product_name: varchar('product_name', 100), // Partial dependency!
  quantity: int('quantity').notNull(),
});

// GOOD: Remove partial dependencies
const products = table('products', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
});

const order_items = table('order_items', {
  id: bigint('id').primaryKey().autoincrement(),
  order_id: bigint('order_id').notNull(),
  product_id: bigint('product_id').notNull().references(() => products.id),
  quantity: int('quantity').notNull(),
});
```

### Third Normal Form (3NF)

**Rule**: No transitive dependencies.

```typescript
// BAD: department_name depends on department_id, not employee
const employees = table('employees', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
  department_id: bigint('department_id').notNull(),
  department_name: varchar('department_name', 100), // Transitive dependency!
});

// GOOD: Remove transitive dependencies
const departments = table('departments', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
});

const employees = table('employees', {
  id: bigint('id').primaryKey().autoincrement(),
  name: varchar('name', 100).notNull(),
  department_id: bigint('department_id')
    .notNull()
    .references(() => departments.id),
});
```

### When to Denormalize

**Acceptable Denormalization:**
- Historical snapshots (e.g., product price at order time)
- Frequently accessed computed values
- Read-heavy reporting tables
- Caching for performance

```typescript
// GOOD: Intentional denormalization for historical data
const order_items = table('order_items', {
  id: bigint('id').primaryKey().autoincrement(),
  order_id: bigint('order_id').notNull(),
  product_id: bigint('product_id').notNull(),
  // Snapshot at order time (intentional denormalization)
  product_name: varchar('product_name', 100).notNull(),
  unit_price: decimal('unit_price', 10, 2).notNull(),
  quantity: int('quantity').notNull(),
});
```

---

## Enum and Status Patterns

### String Enum Pattern

```typescript
// Define enum values
const orderStatusEnum = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;

const orders = table('orders', {
  id: bigint('id').primaryKey().autoincrement(),
  status: varchar('status', 20).notNull().default('pending'),
  // Or use native enum if ORM supports it
  // status: mysqlEnum('status', orderStatusEnum).notNull().default('pending'),
});
```

### Status Transition Considerations

Express valid transitions as code, not comments:

```typescript
const transitions = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
} as const;
```

---

## Index Planning

### Index Strategy

```typescript
const users = table('users', {
  id: bigint('id').primaryKey().autoincrement(),
  email: varchar('email', 255).notNull(),
  branch_id: bigint('branch_id').notNull(),
  status: varchar('status', 20).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  // Unique constraint (automatically creates index)
  email_unique: uniqueIndex('users_email_unique').on(t.email),

  // Foreign key index (always index FK columns)
  branch_idx: index('users_branch_id_idx').on(t.branch_id),

  // Composite index for common query pattern
  branch_status_idx: index('users_branch_status_idx').on(t.branch_id, t.status),
}));
```

### Index Rules

| Scenario | Index Type |
|----------|------------|
| Foreign key columns | Single column index |
| Unique constraints | Unique index |
| Frequent filter columns | Single or composite index |
| Multi-column filters (A AND B) | Composite index (A, B) - order matters |
| Sort columns | Include in index |

---

## Anti-Patterns to Flag

### Type Anti-Patterns
- `int` for IDs (use `bigint`)
- `float`/`double` for money (use `decimal`)
- `varchar(255)` without business reason
- Missing `.notNull()` on required fields
- Random UUIDs as primary keys without time-ordering

### Naming Anti-Patterns
- Mixed case identifiers (`userId`, `UserID`, `user_id` in same schema)
- Inconsistent pluralization (`user` table, `orders` table)
- Abbreviated names (`usr`, `prod`, `qty`)
- Reserved words as names (`order`, `user`, `group` - use `orders`, `users`, `groups`)

### Relationship Anti-Patterns
- Missing foreign key constraints
- Missing ON DELETE behavior specification
- Junction tables without composite primary key or unique constraint
- Circular dependencies without clear hierarchy

### Structure Anti-Patterns
- Repeating columns (`phone1`, `phone2`, `phone3`)
- Storing lists in single columns (comma-separated values)
- Missing timestamp columns (`created_at`, `updated_at`)
- Over-normalization causing excessive joins
- Under-normalization causing update anomalies
