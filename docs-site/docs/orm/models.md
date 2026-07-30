# Models

A Model is a class that maps to a database table and provides the full CRUD and query API for that table. Every model extends `BaseModel` from `struxjs`. This page covers how to configure a model - its table, primary key, timestamps, casting, soft deletes, model events, and more.

For querying (where, find, relationships, etc.) see the [Getting Started](/orm/getting-started) and related ORM pages.

---

## Creating a Model

```bash
npx strux make:model Post
```

Generated file (`app/Models/Post.ts`):

```typescript
import { BaseModel } from "struxjs";

export class Post extends BaseModel {
    protected table = "posts";
    protected primaryKey = "id";
}
```

You can declare TypeScript property types on the model for editor autocomplete. These are declarations only - they do not affect database behavior:

```typescript
import { BaseModel } from "struxjs";

export class Post extends BaseModel {
    protected table = "posts";

    declare id: number;
    declare title: string;
    declare content: string;
    declare status: string;
    declare created_at: string;
    declare updated_at: string;
}
```

---

## Model Properties

### `table`

The database table the model reads from and writes to. Defaults to the lowercase class name (e.g. `Post` → `posts`):

```typescript
export class Post extends BaseModel {
    protected table = "posts";
}
```

### `primaryKey`

The primary key column name. Defaults to `"id"`:

```typescript
export class Post extends BaseModel {
    protected primaryKey = "id";
}
```

### `timestamps`

Whether to automatically manage `created_at` and `updated_at` columns. Defaults to `true`. Set to `false` to disable:

```typescript
export class Post extends BaseModel {
    public timestamps = false;
}
```

### `createdColumn` / `updatedColumn`

Override the column names used for timestamps. Set to `null` to disable a single column:

```typescript
export class Post extends BaseModel {
    public createdColumn = "created_time";
    public updatedColumn = "updated_time";
}
```

```typescript
export class Post extends BaseModel {
    public updatedColumn = null; // Disable updated_at only
}
```

You can also use the static constants:

```typescript
export class Post extends BaseModel {
    public static CREATED_AT = "created_time";
    public static UPDATED_AT = "updated_time";
}
```

---

## Attributes

Every model instance stores its raw column data in the `attributes` object. You can read and write attributes directly via property access - the model's Proxy intercepts these and routes them to `attributes` automatically:

```typescript
const post = await Post.find(1);

// Property access (recommended)
post.title    // reads from post.attributes.title
post.status   // reads from post.attributes.status

// Direct attributes access
post.attributes.title
```

When you assign a value to an instance property, it is stored in `attributes` (unless the property is a known model configuration key like `table`, `primaryKey`, `casts`, etc.):

```typescript
post.title = "New Title";
post.status = "published";
await post.save();
```

---

## Mass Assignment

### `fillable`

Defines the list of columns that are allowed to be mass-assigned via `fill()` and `create()`. Any key not in the list is silently ignored.

When `fillable` is empty (the default), all attributes are accepted without restriction.

```typescript
export class User extends BaseModel {
    protected table = "users";

    protected fillable = ["name", "email", "status"];
}
```

With `fillable` set, extra keys passed from user input are stripped automatically:

```typescript
// Only name, email, status are written - role is stripped
const user = await User.create({
    name: "Alice",
    email: "alice@example.com",
    status: true,
    role: "admin",       // not in fillable - ignored
});

// Create multiple records at once with mass assignment protection
const newUsers = await User.createMany([
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" }
]);
```

The same filtering applies to `fill()`:

```typescript
post.fill({
    title: "New Title",
    status: "published",
    user_id: 99,         // not in fillable - ignored
});
await post.save();
```

`fillable` does **not** apply to direct property assignment (`post.title = "..."`) or to the internal constructor used when hydrating records from the database - only `fill()` and `create()` are filtered.

---

## Attribute Casting

The `casts` property defines how raw database values are automatically converted when accessed on a model instance.

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    public casts = {
        is_published: "boolean",
        views: "integer",
        rating: "float",
        metadata: "json",
        tags: "array",
        published_at: "date",
    };
}
```

Supported cast types:

| Cast type | Description |
| :--- | :--- |
| `"boolean"` | Converts `1`, `"1"`, `"true"` to `true`; others to `false` |
| `"integer"` | `parseInt(value, 10)` |
| `"float"` | `parseFloat(value)` |
| `"json"` | `JSON.parse(value)` - parses stored JSON strings into objects |
| `"array"` | Alias for `"json"` |
| `"object"` | Alias for `"json"` |
| `"date"` | Converts value to a `Date` instance |
| `"string"` | `String(value)` |

Casts are applied transparently on read. When saving, `json`, `array`, and `object` casts are automatically stringified back to JSON before writing to the database.

```typescript
const post = await Post.find(1);

post.is_published // true (boolean, not 1)
post.metadata     // { key: "value" } (object, not a JSON string)
post.published_at // Date instance
```

---

## Soft Deletes

When soft deletes are enabled, calling `delete()` sets a `deleted_at` timestamp on the row instead of removing it. All standard queries automatically exclude soft-deleted records.

### Enabling soft deletes

Set `softDelete = true` on the model. The migration must include a nullable timestamp column (`deleted_at` by default):

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    public softDelete = true;
}
```

In the migration:

```typescript
table.softDeletes(); // Adds nullable deleted_at column
```

### Custom deleted_at column

```typescript
export class Post extends BaseModel {
    public softDelete = true;
    public deletedAtColumn = "removed_at";
}
```

### Soft delete operations

```typescript
// Soft-delete (sets deleted_at, excluded from future queries)
await post.delete();

// Permanently delete regardless of softDelete setting
await post.forceDelete();

// Restore a soft-deleted instance
await post.restore();

// Check if instance is soft-deleted
if (post.trashed()) { ... }
```

### Querying soft-deleted records

```typescript
// Include soft-deleted records
const allPosts = await Post.withTrashed().get();

// Query only soft-deleted records
const trashedPosts = await Post.onlyTrashed().get();

// Restore by primary key
await Post.restoreById(5);
await Post.restoreById([1, 2, 3]);
```

---

## Model Events

Model events let you hook into the lifecycle of a record and run logic before or after each operation. Override the relevant method on your model class.

The `onCreating`, `onUpdating`, `onSaving`, and `onDeleting` hooks can return `false` to **cancel** the operation:

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    // Before INSERT - return false to cancel
    protected async onCreating(): Promise<boolean | void> {
        if (!this.title) return false;
    }

    // After INSERT
    protected async onCreated(): Promise<void> {
        console.log(`Post #${this.id} created`);
    }

    // Before UPDATE - return false to cancel
    protected async onUpdating(): Promise<boolean | void> {}

    // After UPDATE
    protected async onUpdated(): Promise<void> {}

    // Before INSERT or UPDATE - return false to cancel
    protected async onSaving(): Promise<boolean | void> {}

    // After INSERT or UPDATE
    protected async onSaved(): Promise<void> {}

    // Before DELETE - return false to cancel
    protected async onDeleting(): Promise<boolean | void> {
        if (this.is_locked) return false;
    }

    // After DELETE
    protected async onDeleted(): Promise<void> {}
}
```

### Event execution order

For a **create** operation: `onSaving` → `onCreating` → _(insert)_ → `onSaved` → `onCreated`

For an **update** operation: `onSaving` → `onUpdating` → _(update)_ → `onSaved` → `onUpdated`

For a **delete** operation: `onDeleting` → _(delete)_ → `onDeleted`

### Cancelling an operation

Returning `false` from `onCreating`, `onUpdating`, `onSaving`, or `onDeleting` halts the operation and `save()` / `delete()` returns `false`:

```typescript
protected async onDeleting(): Promise<boolean | void> {
    if (this.status === "published") {
        return false; // Prevent deletion of published posts
    }
}
```

---

## Global Scopes

Global scopes apply a query constraint to **every** query executed on the model. Register them inside the static `boot()` method:

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    public static boot(): void {
        super.boot();

        this.addGlobalScope("published", (query) => {
            query.where("status", "published");
        });
    }
}
```

`boot()` is called automatically once per model class before the first query. Always call `super.boot()` to preserve framework-level setup (including the soft delete scope).

### Bypassing global scopes

```typescript
// Exclude one specific scope
const allPosts = await Post.withoutGlobalScope("published").get();

// Exclude all global scopes
const rawPosts = await Post.withoutGlobalScopes().get();

// Exclude multiple specific scopes
const posts = await Post.withoutGlobalScopes("published", "active").get();
```

---

## Local Scopes

Local scopes are reusable query constraints defined as methods prefixed with `scope` on the model. They are applied on demand using `.scope()`:

```typescript
import { BaseModel, EloquentBuilder } from "struxjs";

export class Post extends BaseModel {
    protected table = "posts";

    public scopePublished(builder: EloquentBuilder<Post>) {
        builder.where("status", "published");
    }

    public scopeOfType(builder: EloquentBuilder<Post>, type: string) {
        builder.where("type", type);
    }
}
```

```typescript
const published = await Post.query().scope("published").get();
const tutorials = await Post.query().scope("ofType", "tutorial").get();
```

---

## Serialization

### `toArray()`

Returns a plain object of all attributes with cast values applied. Loaded relationships are included automatically:

```typescript
const post = await Post.with("author").find(1);

post.toArray();
// { id: 1, title: "...", is_published: true, author: { id: 5, name: "..." } }
```

### `toJSON()`

Alias for `toArray()`. Called automatically when the model is passed to `JSON.stringify()` or returned from a Controller action.

---

## Instance Methods

### `fill(attributes)`

Assigns attributes to the model instance without saving. Respects `fillable` when defined:

```typescript
post.fill({ title: "New Title", status: "draft" });
```

### `save()`

Persists the current state of the model to the database. Performs an INSERT if the record has no primary key value, or an UPDATE otherwise. Returns `true` on success, `false` if a lifecycle hook cancelled the operation:

```typescript
const post = new Post();
post.title = "Hello World";
post.status = "draft";
await post.save();
```

### `update(attributes)`

Fills the model with new attributes and saves in one step:

```typescript
await post.update({ title: "Updated Title", status: "published" });
```

### `delete()`

Deletes the record. When `softDelete = true`, sets `deleted_at` instead of removing the row:

```typescript
await post.delete();
```

### `refresh()`

Reloads the model's attributes from the database, discarding any unsaved changes:

```typescript
await post.refresh();
```
