# Aggregations & Grouping

StruxJS ORM provides built-in statistical aggregate functions (`count`, `sum`, `avg`, `min`, `max`), record existence checkers (`exists`, `doesntExist`), and SQL grouping clauses (`groupBy`, `having`, `orHaving`, `havingRaw`).

---

## Aggregate Functions

Aggregate functions return a direct primitive value (number or scalar) calculated by the database engine or memory collection:

### 1. `count(column?)`
Returns the total number of matching records:

```typescript
import { User } from "../app/Models/User.js";

// Count all users
const totalUsers = await User.count();

// Count users matching a specific condition
const activeUsersCount = await User.where("status", "active").count();
```

---

### 2. `sum(column)`
Calculates the sum of values for a specified numerical column:

```typescript
import { Order } from "../app/Models/Order.js";

// Sum order totals
const totalRevenue = await Order.where("status", "completed").sum("total_amount");
```

---

### 3. `avg(column)`
Calculates the average value for a specified numerical column:

```typescript
const averageAge = await User.avg("age");
```

---

### 4. `min(column)` & `max(column)`
Retrieves the minimum or maximum value of a column:

```typescript
const lowestPrice = await Product.min("price");
const highestPrice = await Product.max("price");
```

---

## Record Existence Checkers

Quickly test if records exist without retrieving full model attributes or data models:

### `exists()`
Returns `true` if at least one matching record exists in the database:

```typescript
const hasAdmin = await User.where("role", "admin").exists();

if (hasAdmin) {
    console.log("Admin account found.");
}
```

### `doesntExist()`
Returns `true` if zero matching records exist:

```typescript
const isEmailUnique = await User.where("email", "newuser@example.com").doesntExist();
```

---

## Grouping & Having Clauses

Group database records and apply HAVING criteria to aggregate results.

### `groupBy(...columns)`
Groups query results by one or more database columns:

```typescript
// Select users grouped by role
const roleGroups = await User.select("role")
    .selectRaw("COUNT(*) as total_users")
    .groupBy("role")
    .get();
```

---

### `having(column, operator?, value)`
Applies filtering criteria to grouped aggregate values (analogous to `where`, but evaluated post-grouping):

```typescript
// Find user roles that have more than 5 members
const largeGroups = await User.select("role")
    .selectRaw("COUNT(*) as total")
    .groupBy("role")
    .having("total", ">", 5)
    .get();
```

### `orHaving(column, operator?, value)`
Applies `OR HAVING` filter conditions to grouped queries:

```typescript
const results = await User.select("role")
    .selectRaw("COUNT(*) as total")
    .groupBy("role")
    .having("total", ">", 10)
    .orHaving("role", "=", "admin")
    .get();
```

### `havingRaw(sql, bindings?)`
Applies raw SQL expressions in the `HAVING` clause:

```typescript
const results = await User.select("department_id")
    .groupBy("department_id")
    .havingRaw("AVG(salary) > ?", [50000])
    .get();
```
