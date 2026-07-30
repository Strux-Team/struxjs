# ORM Relationships

StruxJS ORM supports One-to-One, One-to-Many, Belongs-To, and Many-to-Many relationships with eager loading, relationship existence filters, aggregate queries (`withCount`, `withSum`, `withAvg`), and pivot table sync operations.

---

## Defining Relationships

Relationships are defined as methods on your Model class returning relation helper instances (`hasOne`, `hasMany`, `belongsTo`, `belongsToMany`).

### 1. One to One (`hasOne` & `belongsTo`)

A `User` model may have one `Profile`:

```typescript
// app/Models/User.ts
import { BaseModel, HasOne } from "struxjs";
import { Profile } from "./Profile.js";

export class User extends BaseModel {
    protected table = "users";

    public profile(): HasOne {
        return this.hasOne(Profile);
    }
}
```

Inverse relationship on the `Profile` model:

```typescript
// app/Models/Profile.ts
import { BaseModel, BelongsTo } from "struxjs";
import { User } from "./User.js";

export class Profile extends BaseModel {
    protected table = "profiles";

    public user(): BelongsTo {
        return this.belongsTo(User);
    }
}
```

---

### 2. One to Many (`hasMany`)

A `User` model may have many `Post` records:

```typescript
// app/Models/User.ts
import { BaseModel, HasMany } from "struxjs";
import { Post } from "./Post.js";

export class User extends BaseModel {
    protected table = "users";

    public posts(): HasMany {
        return this.hasMany(Post);
    }
}
```

Inverse relationship on `Post`:

```typescript
// app/Models/Post.ts
import { BaseModel, BelongsTo } from "struxjs";
import { User } from "./User.js";

export class Post extends BaseModel {
    protected table = "posts";

    public author(): BelongsTo {
        return this.belongsTo(User);
    }
}
```

---

### 3. Many to Many (`belongsToMany`)

A `User` model may belong to many `Role` records through a pivot table (`role_user`):

```typescript
// app/Models/User.ts
import { BaseModel, BelongsToMany } from "struxjs";
import { Role } from "./Role.js";

export class User extends BaseModel {
    protected table = "users";

    public roles(): BelongsToMany {
        return this.belongsToMany(Role);
    }
}
```

---

## Dynamic Property Access vs. Method Call Querying

StruxJS ORM supports dynamic property lazy-loading and method call querying:

### 1. Dynamic Property Access (`user.posts` / `await user.posts`)

Accessing a relationship as a dynamic property returns either pre-loaded relationship models (via `.with()`) or automatically lazy-loads the related records when awaited:

```typescript
// Eager Loaded (Pre-cached)
const user = await User.with("posts").firstOrFail();
console.log(user.posts); // Returns Collection of Post models

// Automatic Lazy Loading
const singleUser = await User.findOrFail(1);
const posts = await singleUser.posts; // Auto-fetches and caches relation
```

---

### 2. Method Call Querying (`user.posts().where().get()`)

Invoking a relationship method with parentheses (`user.posts()`) returns a relation Query Builder pre-constrained to the parent model instance. You can chain any query builder method (`where`, `whereIn`, `orderBy`, `paginate`, `create`, `save`, `saveMany`, `get`):

```typescript
const user = await User.findOrFail(1);

// Filter & order related posts dynamically
const publishedPosts = await user.posts()
    .where("status", "published")
    .orderBy("created_at", "desc")
    .get();

// Paginate related records
const paginatedPosts = await user.posts().paginate(10);

// Create related record with automatic foreign key assignment (user_id = 1)
const newPost = await user.posts().create({
    title: "New Post Title",
    content: "Post body content"
});

// Create multiple related records at once
const newPosts = await user.posts().createMany([
    { title: "Post 1", content: "Body 1" },
    { title: "Post 2", content: "Body 2" }
]);

// Save existing model instance under parent
const draftPost = new Post({ title: "Draft Post" });
await user.posts().save(draftPost);

// Save multiple model instances under parent at once
await user.posts().saveMany([
    new Post({ title: "Draft 1" }),
    new Post({ title: "Draft 2" })
]);
```

---

## Eager Loading (`with`)

Eager loading solves the N+1 query problem by fetching related models in a single optimized query.

```typescript
// Fetch users with their profile and posts loaded
const users = await User.with("profile", "posts").get();

for (const user of users) {
    console.log(user.profile.bio);
    console.log(user.posts.count());
}
```

---

## Relationship Aggregations (`withCount`, `withSum`, `withAvg`, `withMin`, `withMax`)

Count or calculate aggregate statistics on related records directly in the main query without loading all related models:

```typescript
// Count related posts and roles
const users = await User.withCount("posts", "roles").get();

for (const user of users) {
    console.log(`${user.name} has ${user.posts_count} posts and ${user.roles_count} roles`);
}

// Calculate sum, avg, min, and max of related post attributes
const authors = await User.withSum("posts", "views")
    .withAvg("posts", "rating")
    .withMin("posts", "views")
    .withMax("posts", "views")
    .get();

for (const author of authors) {
    console.log(`Total views: ${author.posts_sum_views}`);
    console.log(`Avg rating: ${author.posts_avg_rating}`);
}
```

---

## Relationship Existence Filters

Filter query results based on the presence or conditions of related records.

### `has(relationName)`
Retrieves models that have at least one related record:

```typescript
// Retrieve users who have written at least one post
const activeAuthors = await User.has("posts").get();
```

### `doesntHave(relationName)`
Retrieves models that do NOT have any related records:

```typescript
// Retrieve users who have zero posts
const newUsers = await User.doesntHave("posts").get();
```

### `whereHas(relationName, callback)`
Filters models where a relationship satisfies custom query conditions:

```typescript
// Retrieve users with posts having more than 100 views
const popularAuthors = await User.whereHas("posts", (query) => {
    query.where("views", ">", 100);
}).get();
```

### `whereRelation(relationName, column, operator?, value?)`
Shorthand for `whereHas` when filtering by a specific column condition:

```typescript
// Retrieve users who have the 'admin' role
const admins = await User.whereRelation("roles", "slug", "admin").get();
```

### `whereDoesntHave(relationName, callback)`
Filters models where a relationship does NOT satisfy specific conditions:

```typescript
// Retrieve users with no published posts
const draftAuthors = await User.whereDoesntHave("posts", (query) => {
    query.where("status", "published");
}).get();
```

---

## Pivot Table Operations (`attach`, `detach`, `sync`, `toggle`, `create`)

Manage Many-to-Many pivot table relationships dynamically.

### `create(attributes, pivotAttributes?)`
Creates a new related model in the target table and automatically attaches it to the parent in the pivot table:

```typescript
const user = await User.findOrFail(1);

// Creates Role record and inserts entry into role_user pivot table
const newRole = await user.roles().create({
    name: "Moderator",
    slug: "moderator"
});
```

### `attach(id | ids, attributes?)`
Inserts new records into the pivot table:

```typescript
const user = await User.findOrFail(1);

// Attach a single role ID
await user.roles().attach(2);

// Attach multiple role IDs with extra pivot table attributes
await user.roles().attach([2, 3], { assigned_by: "admin" });
```

### `detach(id | ids?)`
Removes records from the pivot table:

```typescript
// Detach a single role ID
await user.roles().detach(2);

// Detach multiple role IDs
await user.roles().detach([2, 3]);

// Detach ALL roles from user
await user.roles().detach();
```

### `sync(ids)`
Synchronizes pivot table associations (detaches missing IDs and attaches new IDs):

```typescript
// Ensures user ONLY has role IDs 1 and 4 in pivot table
await user.roles().sync([1, 4]);
```

### `toggle(id | ids)`
Toggles pivot table associations (attaches if currently missing, detaches if currently present):

```typescript
// Toggles role IDs 2 and 5 for user
await user.roles().toggle([2, 5]);
```
