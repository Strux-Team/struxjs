# Database & ORM: Getting Started

StruxJS includes a built-in Active Record ORM and fluent SQL Query Builder supporting SQLite, MySQL, PostgreSQL, and MongoDB.

---

## Environment Configuration

Configure database connection parameters in your application `.env` file:

### 1. SQLite Setup (Simple File-Based Database)

When using **SQLite** (`DB_CONNECTION=sqlite`), only the file path (`DB_DATABASE`) is required. Network parameters such as `DB_HOST`, `DB_PORT`, `DB_USERNAME`, and `DB_PASSWORD` are not needed:

```ini
# SQLite Configuration (Default)
DB_CONNECTION=sqlite
DB_DATABASE=database/database.sqlite
```

### 2. Network SQL Setup (MySQL / PostgreSQL)

For client-server database engines (such as MySQL, MariaDB, or PostgreSQL):

```ini
# MySQL / PostgreSQL Configuration
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=my_strux_app
DB_USERNAME=root
DB_PASSWORD=secret
```

### Supported Connection Drivers

Set `DB_CONNECTION` to one of the following supported drivers:

| Driver | `DB_CONNECTION` | Required `.env` Parameters | NPM Packages Required |
| :--- | :--- | :--- | :--- |
| **SQLite** | `sqlite` | `DB_DATABASE` (file path) | `better-sqlite3` or `sqlite3` |
| **MySQL / MariaDB** | `mysql` | Host, Port, Database, Username, Password | `mysql2` |
| **PostgreSQL** | `postgres` | Host, Port, Database, Username, Password | `pg` |
| **MongoDB** | `mongodb` | Host, Port, Database, Username, Password | `mongodb` |

Configuration parameters are defined inside `config/database.ts`.

---

## Creating Models via CLI

Use the StruxJS CLI to generate Model classes inside `app/Models/`:

```bash
npx strux make:model User
```

Generated Model file (`app/Models/User.ts`):

```typescript
import { BaseModel } from "struxjs";

export class User extends BaseModel {
    /**
     * The database table associated with the model.
     */
    protected static table = "users";

    /**
     * The primary key for the model table.
     */
    protected static primaryKey = "id";
}
```

### Nested Model Organization

Organize models into subdirectories using slash or dot notation:

```bash
npx strux make:model Admin/Role
```

Generates `app/Models/Admin/Role.ts`.

---

## Basic CRUD Operations

### 1. Retrieving Records

> All query methods returning multiple model instances (`User.all()`, `User.get()`, `User.where().get()`, `User.findManyOrFail()`) return a **`Collection`** wrapper object (powered by `collect.js`) instead of a plain array. See the [Collections](/orm/collection) documentation for complete method details.

#### Fetch All Records (`all()`)
```typescript
import { User } from "../app/Models/User.js";

// Retrieve all user records
const users = await User.all();
```

#### Find & OrFail Methods

StruxJS ORM provides `*OrFail` methods that throw an exception with `statusCode: 404` when matching records are not found:

```typescript
// Find user by ID or throw HTTP 404 Exception
const user = await User.findOrFail(42);

// Find first matching query record or throw HTTP 404 Exception
const activeAdmin = await User.where("role", "admin").firstOrFail();

// Find single matching record; throws 404 if 0 records or 500 if >1 records found
const exactUser = await User.where("email", "john@example.com").sole(); // Or soleOrFail()

// Find multiple models by IDs array; throws 404 if ANY primary key is missing
const users = await User.findManyOrFail([1, 2, 3]);
```

#### Filtering Records (`where()`)
```typescript
// Single condition
const activeUsers = await User.where("status", "active").get();

// Retrieve first matching record
const user = await User.where("email", "john@example.com").first();

// Multiple conditions & ordering
const users = await User.where("status", "active")
    .where("role", "admin")
    .orderBy("created_at", "desc")
    .limit(10)
    .get();
```

---

### 2. Creating Records

#### Direct Class Instantiation (`save()`)

```typescript
const user = new User();
user.name = "Alice";
user.email = "alice@example.com";
user.password = "secret123";

await user.save(); // Persists to database and sets generated primary key
```

#### Mass Assignment (`create()`)

```typescript
const user = await User.create({
    name: "Bob",
    email: "bob@example.com",
    password: "secret123",
    status: "active"
});
```

#### Update or Create (`updateOrCreate()`)

```typescript
const user = await User.updateOrCreate(
    { email: "bob@example.com" }, // Matching condition
    { name: "Bob Smith", status: "active" } // Values to update or insert
);
```

---

### 3. Updating Records

#### Model Instance Update (`update()` / `save()`)

```typescript
const user = await User.findOrFail(42);

// Update single properties and save
user.name = "Updated Name";
await user.save();

// Or mass update properties
await user.update({
    name: "Updated Name",
    status: "inactive"
});
```

#### Batch Query Update

```typescript
await User.where("status", "pending")
    .update({ status: "archived" });
```

---

### 4. Deleting Records

#### Direct Key Deletion (`destroy()`)

Delete records directly by primary key ID or array of IDs without fetching instances manually:

```typescript
// Delete single record by ID
const deletedCount = await User.destroy(42);

// Delete multiple records by array of IDs
const deletedCount = await User.destroy([10, 20, 30]);
```

#### Instance Deletion (`delete()`)

```typescript
const user = await User.findOrFail(42);
await user.delete(); // Triggers model deletion events
```

#### Batch Query Deletion

```typescript
await User.where("status", "inactive").delete();
```

---

## Fluent Query Builder (`DB`)

For direct database operations without Model instantiation, use the `DB` query builder facade:

```typescript
import { DB } from "struxjs";

// Select query
const users = await DB.table("users")
    .where("status", "active")
    .orderBy("name", "asc")
    .get();

// Raw SQL query
const results = await DB.select("SELECT * FROM users WHERE status = ?", ["active"]);

// Database Transactions
await DB.transaction(async (trx) => {
    await trx.table("users").where("id", 1).decrement("balance", 100);
    await trx.table("users").where("id", 2).increment("balance", 100);
});
```
