# Migrations

Migrations are version-controlled schema files that define how your database tables are created, modified, and removed. Each migration file exports an `up` function (applied when migrating) and a `down` function (applied when rolling back). StruxJS tracks which migrations have been run in a `migrations` table and executes only the pending ones on each run.

---

## Creating a Migration

Use the CLI to generate a new timestamped migration file inside `database/migrations/`:

```bash
npx strux make:migration <name>
```

The `<name>` argument describes what the migration does. StruxJS uses it to pre-populate the file template and determine the target table name.

### Create table migration

When the name starts with `create_`, StruxJS generates a `Schema.create` stub:

```bash
npx strux make:migration create_users_table
```

Generated file (`database/migrations/20260727102146_create_users_table.ts`):

```typescript
import { Schema, TableBuilder } from "struxjs";

export default {
    async up() {
        await Schema.create("users", (table: TableBuilder) => {
            table.id();
            table.timestamps();
        });
    },

    async down() {
        await Schema.dropIfExists("users");
    }
};
```

### Modify table migration

For any other name pattern, StruxJS generates a `Schema.table` stub for modifying an existing table:

```bash
npx strux make:migration add_views_to_posts_table
```

Generated file:

```typescript
import { Schema, TableBuilder } from "struxjs";

export default {
    async up() {
        await Schema.table("posts", (table: TableBuilder) => {
            // Add columns here
        });
    },

    async down() {
        await Schema.table("posts", (table: TableBuilder) => {
            // Reverse changes here
        });
    }
};
```

### File naming convention

Generated files are prefixed with a 14-digit UTC timestamp (`YYYYMMDDHHmmss`). Migrations are sorted and executed in ascending filename order, so timestamps guarantee the correct execution sequence.

```
20260727032725_create_users_table.ts
20260727033356_create_posts_table.ts
20260727033728_add_views_to_posts_table.ts
```

---

## Running Migrations

### Run pending migrations

```bash
npx strux migrate
```

Executes all migration files that have not yet been recorded in the `migrations` tracking table. Each run groups the executed files into a **batch**. Batch numbers are used by `migrate:rollback` to identify which migrations belong to the last run.

```
Running migrations (Batch 1)...
  Migrating: 20260727032725_create_users_table
  Migrated:  20260727032725_create_users_table (12ms)
  Migrating: 20260727033356_create_posts_table
  Migrated:  20260727033356_create_posts_table (8ms)
SUCCESS: Batch 1 migrated successfully.
```

If there are no pending migrations, StruxJS outputs `Nothing to migrate.` and exits cleanly.

---

## Rolling Back Migrations

### Rollback the last batch

```bash
npx strux migrate:rollback
```

Reverses all migrations from the most recent batch by calling their `down` functions in reverse order, then removes those records from the tracking table.

```
Rolling back migrations (Batch 2)...
  Rolling back: 20260727033728_add_views_to_posts_table
  Rolled back:  20260727033728_add_views_to_posts_table (5ms)
SUCCESS: Batch 2 rolled back successfully.
```

### Rollback multiple batches (`--step`)

Use the `--step` option to roll back more than one batch in a single command:

```bash
npx strux migrate:rollback --step=2
```

StruxJS rolls back each batch in sequence, starting from the most recent, until the specified number of batches have been reversed:

```
Rolling back migrations (Batch 2)...
  Rolling back: 20260727033728_add_views_to_posts_table
  Rolled back:  20260727033728_add_views_to_posts_table (5ms)
SUCCESS: Batch 2 rolled back successfully.

Rolling back migrations (Batch 1)...
  Rolling back: 20260727033356_create_posts_table
  Rolled back:  20260727033356_create_posts_table (6ms)
  Rolling back: 20260727032725_create_users_table
  Rolled back:  20260727032725_create_users_table (4ms)
SUCCESS: Batch 1 rolled back successfully.
```

Omitting `--step` defaults to `1` (only the last batch).

### Reset all migrations

```bash
npx strux migrate:reset
```

Rolls back every migration that has been recorded, regardless of batch. All `down` functions are called in reverse order (latest first). The `migrations` tracking table is cleared but not dropped.

### Refresh (reset and re-run)

```bash
npx strux migrate:refresh
```

Equivalent to running `migrate:reset` followed immediately by `migrate`. Useful for rebuilding your schema from scratch during development without losing the migration files themselves.

### Fresh (drop all tables and re-run)

```bash
npx strux migrate:fresh
```

Drops every table in the database entirely, then re-runs all migrations from the beginning. Unlike `migrate:refresh`, this does not rely on `down` functions - it forcefully removes all tables directly.

You can optionally seed the database after a fresh migration:

```bash
npx strux migrate:fresh --seed
```

This runs `migrate:fresh` and then executes the `DatabaseSeeder` automatically.

### Check migration status

```bash
npx strux migrate:status
```

Prints a table showing every migration file, whether it has been run, and which batch it belongs to:

```
+------+------------------------------------------+-------+
| Ran? | Migration                                | Batch |
+------+------------------------------------------+-------+
|  Yes | 20260727032725_create_users_table        |     1 |
|  Yes | 20260727033356_create_posts_table        |     1 |
|  No  | 20260727033728_add_views_to_posts_table  |       |
+------+------------------------------------------+-------+
```

---

## CLI Command Reference

| Command | Description |
| :--- | :--- |
| `npx strux make:migration <name>` | Create a new migration file |
| `npx strux migrate` | Run all pending migrations |
| `npx strux migrate:rollback` | Roll back the last batch |
| `npx strux migrate:rollback --step=<n>` | Roll back the last N batches |
| `npx strux migrate:reset` | Roll back all migrations |
| `npx strux migrate:refresh` | Reset and re-run all migrations |
| `npx strux migrate:fresh` | Drop all tables and re-run all migrations |
| `npx strux migrate:fresh --seed` | Fresh migration + run DatabaseSeeder |
| `npx strux migrate:status` | Show migration run status |

---

## Schema API

The `Schema` class is the facade used inside migration files to create, modify, and drop database structures.

### `Schema.create(table, callback)`

Creates a new table. The callback receives a `TableBuilder` instance for defining columns:

```typescript
await Schema.create("products", (table: TableBuilder) => {
    table.id();
    table.string("name");
    table.decimal("price", 10, 2);
    table.timestamps();
});
```

### `Schema.table(table, callback)`

Modifies an existing table by adding, changing, or removing columns:

```typescript
await Schema.table("products", (table: TableBuilder) => {
    table.boolean("is_featured").defaultTo(false);
});
```

### `Schema.dropIfExists(table)`

Drops a table if it exists. Safe to call even if the table has already been removed:

```typescript
await Schema.dropIfExists("products");
```

### `Schema.drop(table)`

Alias for `dropIfExists`.

### `Schema.rename(from, to)` / `Schema.renameTable(from, to)`

Renames a table:

```typescript
await Schema.rename("posts", "articles");
```

### `Schema.hasTable(table)`

Returns `true` if the specified table exists:

```typescript
if (await Schema.hasTable("products")) {
    // ...
}
```

### `Schema.hasColumn(table, column)`

Returns `true` if the specified column exists in the table:

```typescript
if (await Schema.hasColumn("users", "email_verified_at")) {
    // ...
}
```

---

## TableBuilder Column Types

The `TableBuilder` instance passed to `Schema.create` and `Schema.table` provides the following column definition methods.

### Primary Keys

| Method | Description |
| :--- | :--- |
| `table.id(column?)` | Auto-increment integer primary key. Defaults to `"id"` |
| `table.bigIncrements(column?)` | Big auto-increment integer primary key |
| `table.uuid(column?)` | UUID column, defaults to `"id"` |

### Strings & Text

| Method | Description |
| :--- | :--- |
| `table.string(column, length?)` | VARCHAR column. Default length `255` |
| `table.text(column)` | TEXT column |
| `table.longText(column)` | LONGTEXT column |

### Numbers

| Method | Description |
| :--- | :--- |
| `table.integer(column)` | INTEGER column |
| `table.unsignedInteger(column)` | Unsigned INTEGER column |
| `table.bigInteger(column)` | BIGINT column |
| `table.tinyInteger(column)` | TINYINT column |
| `table.smallInteger(column)` | SMALLINT column |
| `table.float(column, precision?, scale?)` | FLOAT column. Defaults: precision `8`, scale `2` |
| `table.decimal(column, precision?, scale?)` | DECIMAL column. Defaults: precision `8`, scale `2` |

### Booleans, Dates & Times

| Method | Description |
| :--- | :--- |
| `table.boolean(column)` | BOOLEAN column |
| `table.date(column)` | DATE column |
| `table.dateTime(column)` | DATETIME column |
| `table.timestamp(column)` | TIMESTAMP column |
| `table.timestamps()` | Adds `created_at` and `updated_at` TIMESTAMP columns with `CURRENT_TIMESTAMP` defaults |
| `table.softDeletes(column?)` | Nullable TIMESTAMP column for soft deletes. Defaults to `"deleted_at"` |

### Other Types

| Method | Description |
| :--- | :--- |
| `table.enum(column, values[])` | ENUM column with allowed string values |
| `table.json(column)` | JSON column |
| `table.binary(column)` | BINARY / BLOB column |

---

## Column Modifiers

Column builder methods return a chainable column builder that supports the following modifiers:

```typescript
table.string("nickname").nullable();
table.integer("views").defaultTo(0);
table.string("email").unique();
table.string("title", 500).change();  // Modify an existing column
```

| Modifier | Description |
| :--- | :--- |
| `.nullable()` | Allow NULL values |
| `.defaultTo(value)` | Set a default value |
| `.unique()` | Add a unique constraint |
| `.change()` | Alter an existing column instead of creating a new one (alias for `.alter()`) |

---

## Indexes & Foreign Keys

### Adding indexes

```typescript
await Schema.table("posts", (table: TableBuilder) => {
    table.index("user_id");
    table.unique(["email", "tenant_id"], "unique_email_per_tenant");
});
```

| Method | Description |
| :--- | :--- |
| `table.index(columns, name?)` | Add a plain index on one or more columns |
| `table.unique(columns, name?)` | Add a unique index on one or more columns |

### Foreign keys - shorthand style

`foreignId` creates an unsigned integer column and chains a fluent constraint builder:

```typescript
table.foreignId("user_id").constrained("users").onDelete("cascade");
```

`constrained(table?, foreignColumn?)` defaults the target table to the column name minus the `_id` suffix (e.g. `user_id` resolves to `users`), and defaults the referenced column to `id`.

```typescript
// Both lines are equivalent
table.foreignId("user_id").constrained().onDelete("cascade");
table.foreignId("user_id").constrained("users", "id").onDelete("cascade");
```

### Foreign keys - explicit style

Use `foreign` for full control over the constraint definition:

```typescript
table.foreign("user_id").references("id").on("users").onDelete("cascade");
table.foreign("user_id").references("id").inTable("users").onUpdate("cascade");
```

### Supported referential actions

`onDelete` and `onUpdate` accept: `"cascade"`, `"SET NULL"`, `"RESTRICT"`, `"NO ACTION"`.

---

## Modifying Columns

Use `Schema.table` with the `.change()` modifier to alter an existing column's definition:

```typescript
// Change the length of an existing VARCHAR column
await Schema.table("posts", (table: TableBuilder) => {
    table.string("title", 500).change();
});
```

To reverse it in the `down` function:

```typescript
async down() {
    await Schema.table("posts", (table: TableBuilder) => {
        table.string("title", 255).change();
    });
}
```

---

## Renaming & Dropping Columns

### Renaming a column

```typescript
await Schema.table("posts", (table: TableBuilder) => {
    table.renameColumn("title", "subject");
});
```

### Dropping a single column

```typescript
await Schema.table("posts", (table: TableBuilder) => {
    table.dropColumn("slug");
});
```

### Dropping multiple columns

```typescript
await Schema.table("posts", (table: TableBuilder) => {
    table.dropColumns("views", "slug", "excerpt");
});
```

---

## Complete Migration Examples

### Creating a table with relationships

```typescript
import { Schema, TableBuilder } from "struxjs";

export default {
    async up() {
        await Schema.create("posts", (table: TableBuilder) => {
            table.id();
            table.foreignId("user_id").constrained("users").onDelete("cascade");
            table.string("title");
            table.text("content");
            table.enum("status", ["draft", "published", "archived"]).defaultTo("draft");
            table.integer("views").defaultTo(0);
            table.timestamps();
            table.softDeletes();
        });
    },

    async down() {
        await Schema.dropIfExists("posts");
    }
};
```

### Adding columns to an existing table

```typescript
import { Schema, TableBuilder } from "struxjs";

export default {
    async up() {
        await Schema.table("posts", (table: TableBuilder) => {
            table.integer("views").defaultTo(0);
            table.string("slug").nullable();
        });
    },

    async down() {
        await Schema.table("posts", (table: TableBuilder) => {
            table.dropColumn("views");
            table.dropColumn("slug");
        });
    }
};
```

### Renaming a column

```typescript
import { Schema, TableBuilder } from "struxjs";

export default {
    async up() {
        await Schema.table("posts", (table: TableBuilder) => {
            table.renameColumn("title", "subject");
        });
    },

    async down() {
        await Schema.table("posts", (table: TableBuilder) => {
            table.renameColumn("subject", "title");
        });
    }
};
```
