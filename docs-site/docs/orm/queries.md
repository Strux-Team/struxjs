# Query Filters & Clauses

StruxJS ORM provides a fluent SQL and NoSQL query builder supporting basic comparison clauses, nested logical grouping, subqueries, array lookups, conditional clauses, raw SQL expressions, local/global scopes, joins, and single-value/array extraction (`pluck`, `value`).

---

## Basic Comparison Clauses (`where`)

### Column and Value Equality
Passing two arguments defaults to equality (`=`):

```typescript
import { User } from "../app/Models/User.js";

// Generates: WHERE `status` = 'active'
const activeUsers = await User.where("status", "active").get();
```

### Operator Comparison
Passing three arguments specifies a custom comparison operator (`=`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `ILIKE`):

```typescript
// Generates: WHERE `age` >= 18 AND `name` LIKE '%John%'
const users = await User.where("age", ">=", 18)
    .where("name", "like", "%John%")
    .get();
```

### Key-Value Object Filtering
Pass an object dictionary to filter by multiple exact key-value pairs:

```typescript
// Generates: WHERE `status` = 'active' AND `role` = 'admin'
const admins = await User.where({
    status: "active",
    role: "admin"
}).get();
```

### `orWhere` Clause
Chain `orWhere` to append `OR` comparison statements:

```typescript
// Generates: WHERE `role` = 'admin' OR `role` = 'editor'
const staff = await User.where("role", "admin")
    .orWhere("role", "editor")
    .get();
```

---

## Nested Logical Grouping

Wrap conditions inside closure callbacks to construct parenthesized logical groups:

```typescript
// Generates: WHERE `status` = 'active' AND (`role` = 'admin' OR `role` = 'editor')
const users = await User.where("status", "active")
    .where((query) => {
        query.where("role", "admin")
             .orWhere("role", "editor");
    })
    .get();
```

---

## Subqueries in Where Clauses

StruxJS allows nesting subqueries directly inside `where`, `whereIn`, `selectSub`, and `fromSub`.

### 1. Subquery Value Comparison

Pass an `QueryBuilder` instance as a comparison value:

```typescript
// Select users whose account balance exceeds the average balance of all users
const highBalanceUsers = await User.where("balance", ">", 
    User.selectRaw("AVG(balance)")
).get();
```

### 2. Subquery `whereIn` / `whereNotIn`

Pass a subquery returning a single column to `whereIn`:

```typescript
import { Post } from "../app/Models/Post.js";

// Generates: WHERE `id` IN (SELECT `user_id` FROM `posts` WHERE `views` > 1000)
const topAuthors = await User.whereIn("id", 
    Post.where("views", ">", 1000).select("user_id")
).get();
```

### 3. Exists Subqueries (`whereExists` & `whereNotExists`)

Check for record presence via subquery:

```typescript
// Select users who have written at least one post
const authors = await User.whereExists(
    Post.whereRaw("posts.user_id = users.id")
).get();
```

---

## Array & Range Clauses

### `whereIn` / `whereNotIn`

Filter column values against an array of options:

```typescript
const users = await User.whereIn("status", ["active", "pending"]).get();
const validUsers = await User.whereNotIn("role", ["banned", "suspended"]).get();
```

### `whereBetween`

Filter column values within an inclusive minimum and maximum range:

```typescript
// Generates: WHERE `age` BETWEEN 18 AND 30
const youngAdults = await User.whereBetween("age", [18, 30]).get();
```

### `whereNull` / `whereNotNull`

Filter columns for `NULL` or non-`NULL` database values:

```typescript
const unverifiedUsers = await User.whereNull("email_verified_at").get();
const verifiedUsers = await User.whereNotNull("email_verified_at").get();
```

---

## Data Extraction (`pluck` & `value`)

### `pluck(column, key?)`
Extracts a flat array of values for a single column, or a Key-Value dictionary if a key parameter is provided:

```typescript
// Extract flat array of email addresses: ['alice@example.com', 'bob@example.com']
const emails = await User.pluck("email");

// Extract key-value dictionary mapping IDs to names: { 1: "Alice", 2: "Bob" }
const userMap = await User.pluck("name", "id");
```

### `value(column)`
Extracts a single column value directly from the first matching record:

```typescript
// Directly returns string 'alice@example.com' or null if not found
const userEmail = await User.where("id", 1).value("email");
```

---

## Conditional Query Execution (`when` / `unless`)

Execute query clauses conditionally based on truthy or falsy input parameters without messy `if` statements:

```typescript
export class UserController {
    public async index(req, res) {
        const searchName = req.input("search");
        const selectedRole = req.input("role");

        const users = await User.query()
            .when(searchName, (query, val) => {
                query.where("name", "like", `%${val}%`);
            })
            .when(selectedRole, (query, val) => {
                query.where("role", val);
            })
            .get();

        return res.json({ users });
    }
}
```

---

## Raw SQL Expressions

Execute raw SQL fragments for advanced database functions, mathematical calculations, or database-specific syntax:

```typescript
// Raw WHERE clause
const users = await User.whereRaw("LOWER(email) = ?", ["john@example.com"]).get();

// Raw ORDER BY clause
const randomUsers = await User.orderByRaw("RANDOM()").limit(5).get();

// Raw HAVING clause
const activeGroups = await User.select("role")
    .groupBy("role")
    .havingRaw("COUNT(*) > ?", [5])
    .get();
```

---

## Sorting & Pagination

### `orderBy` / `latest` / `oldest`

```typescript
const users = await User.orderBy("created_at", "desc").get();

// Shortcut for orderBy("created_at", "desc")
const recentUsers = await User.latest().get();

// Shortcut for orderBy("created_at", "asc")
const oldestUsers = await User.oldest().get();
```

### `limit` / `take` / `offset` / `skip`

```typescript
const subset = await User.orderBy("id", "asc")
    .skip(20)   // Offset
    .take(10)   // Limit
    .get();
```

### Chunking & Lazy Evaluation

When processing thousands of database records, using `.get()` will load all records into RAM simultaneously. Instead, use `.chunk()` or `.lazy()` to fetch a small subset of records at a time, keeping memory usage extremely low.

**Using `chunk()`**

```typescript
await User.where("status", "active").chunk(200, async (users, page) => {
    // Process 200 users at a time
    for (const user of users) {
        await emailService.send(user);
    }
    
    // Return false to stop chunking early
    // return false; 
});
```

**Using `lazy()`**

Returns an `AsyncGenerator` allowing you to iterate over massive datasets seamlessly while StruxJS manages chunking under the hood:

```typescript
// Fetches 1000 records at a time behind the scenes
for await (const user of User.lazy(1000)) {
    console.log(user.name);
}
```

---

## Query Scopes

### 1. Local Scopes

Define reusable model query filters by prefixing method names with `scope`:

```typescript
// app/Models/User.ts
export class User extends BaseModel {
    protected static table = "users";

    public scopeActive(query: QueryBuilder) {
        return query.where("status", "active");
    }

    public scopeOfType(query: QueryBuilder, type: string) {
        return query.where("type", type);
    }
}
```

Apply local scopes using `.scope()`:

```typescript
const activeAdmins = await User.query()
    .scope("active")
    .scope("ofType", "admin")
    .get();
```

---

### 2. Global Scopes

Global scopes are applied automatically to **every** query on the Model. Register global scopes inside the model `boot()` method:

```typescript
// app/Models/Post.ts
export class Post extends BaseModel {
    protected static table = "posts";

    protected static boot() {
        super.boot();

        // Automatically append WHERE status = 'published' to all queries
        this.addGlobalScope("published", (query) => {
            query.where("status", "published");
        });
    }
}
```

#### Removing Global Scopes

Bypass registered global scopes using `.withoutGlobalScope()` or `.withoutGlobalScopes()`:

```typescript
// Exclude specific global scope
const allPosts = await Post.query().withoutGlobalScope("published").get();

// Exclude ALL global scopes
const rawPosts = await Post.query().withoutGlobalScopes().get();
```
