# Raw SQL Queries

StruxJS supports executing full raw SQL statements using the `DB` facade as well as embedding partial raw SQL expressions within Model query builder chains.

---

## 1. Full Raw SQL Queries (`DB` Facade)

Use the static methods on the `DB` facade to execute raw SQL queries with parameter binding arrays.

### Raw `SELECT` Queries (`DB.select`)

`DB.select()` executes a raw SQL SELECT query and returns the results wrapped inside a `Collection` for easy filtering and mapping:

```typescript
import { DB } from "struxjs";

// Execute raw SELECT with positional bindings (?)
const users = await DB.select("SELECT * FROM users WHERE status = ? AND age >= ?", ["active", 18]);

// Manipulate results via Collection helper methods
const emails = users.pluck("email").all();
```

---

### Raw `INSERT` Queries (`DB.insert`)

Execute raw SQL INSERT statements:

```typescript
await DB.insert(
    "INSERT INTO users (name, email, created_at) VALUES (?, ?, ?)",
    ["Alice", "alice@example.com", new Date()]
);
```

---

### Raw `UPDATE` Queries (`DB.update`)

Execute raw SQL UPDATE statements. Returns the total number of affected rows:

```typescript
const affectedRows = await DB.update(
    "UPDATE users SET status = ? WHERE last_login < ?",
    ["archived", "2025-01-01"]
);

console.log(`Updated ${affectedRows} user records.`);
```

---

### Raw `DELETE` Queries (`DB.delete`)

Execute raw SQL DELETE statements. Returns the number of deleted records:

```typescript
const deletedCount = await DB.delete(
    "DELETE FROM users WHERE status = ?",
    ["unverified"]
);
```

---

### General SQL Statements (`DB.statement`)

Execute arbitrary DDL or DML statements (such as schema alterations, setting flags, or database maintenance commands):

```typescript
// Disable foreign key checks for table truncates
await DB.statement("SET FOREIGN_KEY_CHECKS = 0;");
```

---

## 2. Partial Raw SQL Expressions (Query Builder)

Instead of writing full SQL queries from scratch, embed partial raw SQL fragments into Model query builder methods using `DB.raw()` or dedicated `*Raw` helper methods.

### `DB.raw()` Expressions

Pass `DB.raw()` inside `.select()`, `.where()`, or `.update()`:

```typescript
import { DB, User } from "struxjs";

// Use raw expression in select
const users = await User.select(
    "id",
    "name",
    DB.raw("COUNT(posts.id) as total_posts")
).get();

// Increment numerical column in update
await User.where("id", 1).update({
    views: DB.raw("views + 1")
});
```

---

### `selectRaw()`

Inject raw SQL select expressions or calculations:

```typescript
const users = await User.selectRaw("id, CONCAT(first_name, ' ', last_name) as full_name")
    .where("status", "active")
    .get();
```

---

### `whereRaw()` & `orWhereRaw()`

Inject raw SQL fragments into `WHERE` or `OR WHERE` clauses:

```typescript
// Raw WHERE clause with bindings
const users = await User.whereRaw("LOWER(email) = ?", ["john@example.com"])
    .orWhereRaw("DATEDIFF(NOW(), created_at) > ?", [30])
    .get();
```

---

### `orderByRaw()`

Inject custom raw SQL ordering expressions (e.g. `RANDOM()`, `FIELD()`, or mathematical expressions):

```typescript
// Random ordering
const randomUsers = await User.where("status", "active")
    .orderByRaw("RANDOM()")
    .limit(5)
    .get();

// Custom field priority ordering
const prioritizedUsers = await User.orderByRaw("FIELD(status, 'admin', 'editor', 'user')")
    .get();
```

---

### `havingRaw()`

Inject raw SQL expressions into the `HAVING` clause post-grouping:

```typescript
const results = await User.select("department_id")
    .selectRaw("AVG(salary) as avg_salary")
    .groupBy("department_id")
    .havingRaw("AVG(salary) > ?", [50000])
    .get();
```

---

## 3. SQL Injection Protection & Parameter Bindings

Always pass user inputs inside the positional `bindings` parameter array (using `?` placeholders) instead of string concatenating variables directly:

```typescript
// Incorrect: Vulnerable to SQL Injection
const unsafeInput = req.input("email");
await DB.select(`SELECT * FROM users WHERE email = '${unsafeInput}'`);

// Correct: Safe prepared statement bindings
const safeInput = req.input("email");
await DB.select("SELECT * FROM users WHERE email = ?", [safeInput]);
```
