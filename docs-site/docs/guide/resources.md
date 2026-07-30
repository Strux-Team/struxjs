# API Resources

API Resources (also called Transformers) are the intermediary layer between the model and the JSON response. Instead of returning raw data directly from the database, you control exactly which fields are exposed, reformat values, and add computed fields.

---

## Creating a Resource

```bash
npx strux make:resource UserResource
```

This creates the file `app/Resources/UserResource.ts`:

```typescript
import { Resource } from "struxjs";

export class UserResource extends Resource {
    public transform(user: any) {
        return {
            id:         user.id,
            name:       user.name,
            email:      user.email,
            created_at: user.created_at,
        };
    }
}
```

Implement the `transform()` method - it receives the plain object of the model and returns the object that will appear in the JSON response.

---

## Using it in a Controller

### Single resource

```typescript
import { Request, Response } from "struxjs";
import { User } from "../Models/User.js";
import { UserResource } from "../Resources/UserResource.js";

export class UserController {
    public async show(request: Request, response: Response) {
        const user = await User.findOrFail(request.params.id);

        return new UserResource(user);
    }
}
```

Response:

```json
{
    "data": {
        "id": 1,
        "name": "Alice",
        "email": "alice@example.com",
        "created_at": "2026-01-01T00:00:00.000Z"
    }
}
```

By default, the response is wrapped in a `"data"` key. See [Wrapping](#response-wrapping) to change this.

### Static factory `make()`

```typescript
return UserResource.make(user);
// Equivalent to: new UserResource(user)
```

---

## Collection

Returns a list of items, with each item transformed through the resource.

### Inline collection

```typescript
public async index(request: Request, response: Response) {
    const users = await User.all();
    return UserResource.collection(users);
}
```

Response:

```json
{
    "data": [
        { "id": 1, "name": "Alice", "email": "alice@example.com" },
        { "id": 2, "name": "Bob",   "email": "bob@example.com" }
    ]
}
```

### Dedicated Collection class

Create a dedicated class when you need extra logic or metadata for the collection:

```bash
npx strux make:resource UserResource --collection
```

This also creates `app/Resources/UserResourceCollection.ts`:

```typescript
import { ResourceCollection } from "struxjs";
import { UserResource } from "./UserResource.js";

export class UserResourceCollection extends ResourceCollection {
    constructor(data: any[] | { data: any[]; [key: string]: any }) {
        super(UserResource, data);
    }
}
```

Use it in the controller:

```typescript
import { UserResourceCollection } from "../Resources/UserResourceCollection.js";

public async index(request: Request, response: Response) {
    const users = await User.all();
    return new UserResourceCollection(users);
}
```

---

## Pagination

Pass the result of `paginate()` directly into a resource collection - pagination metadata is automatically attached to the response:

```typescript
public async index(request: Request, response: Response) {
    const users = await User.paginate(15);

    // Inline collection
    return UserResource.collection(users);

    // or dedicated collection class
    return new UserResourceCollection(users);
}
```

Response:

```json
{
    "data": [
        { "id": 1, "name": "Alice", "email": "alice@example.com" },
        { "id": 2, "name": "Bob",   "email": "bob@example.com" }
    ],
    "meta": {
        "total": 100,
        "per_page": 15,
        "current_page": 1,
        "last_page": 7,
        "from": 1,
        "to": 15
    },
    "links": {
        "first": "?page=1",
        "last":  "?page=7",
        "prev":  null,
        "next":  "?page=2"
    }
}
```

---

## Additional Data

Add extra fields to the top level of the response with `.additional()`:

```typescript
public async show(request: Request, response: Response) {
    const user = await User.findOrFail(request.params.id);

    return new UserResource(user).additional({
        meta: {
            generated_at: new Date().toISOString(),
            version: "1.0"
        }
    });
}
```

Response:

```json
{
    "data": { "id": 1, "name": "Alice" },
    "meta": {
        "generated_at": "2026-07-28T10:00:00.000Z",
        "version": "1.0"
    }
}
```

---

## HTTP Status Code

Override the status code with `.withStatus()`:

```typescript
public async store(request: Request, response: Response) {
    const user = await User.create(request.body);

    return new UserResource(user).withStatus(201);
}
```

---

## Computed & Conditional Fields

Use `transform()` to add computed fields or hide fields conditionally:

```typescript
export class UserResource extends Resource {
    public transform(user: any) {
        return {
            id:           user.id,
            name:         user.name,
            email:        user.email,
            // Computed field
            display_name: `${user.name} <${user.email}>`,
            // Conditional - only shown if a value exists
            ...(user.phone && { phone: user.phone }),
            // Reformatted
            created_at:   new Date(user.created_at).toLocaleDateString("vi-VN"),
        };
    }
}
```

### Async transform

`transform()` can be async - use this when you need to query additional data:

```typescript
export class PostResource extends Resource {
    public async transform(post: any) {
        const commentCount = await Comment.where("post_id", post.id).count();

        return {
            id:            post.id,
            title:         post.title,
            body:          post.body,
            comment_count: commentCount,
            created_at:    post.created_at,
        };
    }
}
```

---

## Nested Resources

Use a resource inside another resource to transform relations:

```typescript
import { Resource } from "struxjs";
import { UserResource } from "./UserResource.js";
import { TagResource } from "./TagResource.js";

export class PostResource extends Resource {
    public async transform(post: any) {
        return {
            id:    post.id,
            title: post.title,
            body:  post.body,
            // Nested single resource
            author: post.author
                ? (await new UserResource(post.author).resolve()).body.data
                : null,
            // Nested collection
            tags: post.tags
                ? await Promise.all(
                    post.tags.map(async (tag: any) =>
                        (await new TagResource(tag).resolve()).body.data
                    )
                )
                : [],
        };
    }
}
```

::: tip
Use `(await resource.resolve()).body.data` when nesting - `resolve()` automatically unwraps BaseModel instances. If the data is already a plain object (not a BaseModel), you can call `transform()` directly.
:::

---

## Response Wrapping

By default, a resource is wrapped in a `"data"` key. This can be changed globally in the `boot` method of `AppServiceProvider`:

```typescript
import { Resource } from "struxjs";

// Change the wrap key
Resource.wrap("result");
// Response: { "result": { ... } }

// Disable wrapping entirely
Resource.withoutWrapping();
// Response: { "id": 1, "name": "Alice", ... }
```

---

## Complete Example

```typescript
// app/Resources/UserResource.ts
import { Resource } from "struxjs";
import { PostResource } from "./PostResource.js";

export class UserResource extends Resource {
    public transform(user: any) {
        return {
            id:         user.id,
            name:       user.name,
            email:      user.email,
            role:       user.role ?? "member",
            avatar_url: user.avatar
                ? `/storage/avatars/${user.avatar}`
                : `/avatars/default.png`,
            // Only shown if the relation has been loaded
            ...(user.posts && {
                posts: await Promise.all(
                    user.posts.map(async (p: any) =>
                        (await new PostResource(p).resolve()).body.data
                    )
                )
            }),
            created_at: user.created_at,
        };
    }
}
```

```typescript
// app/Controllers/UserController.ts
import { Request, Response } from "struxjs";
import { User } from "../Models/User.js";
import { UserResource } from "../Resources/UserResource.js";

export class UserController {
    // GET /users
    public async index(request: Request, response: Response) {
        const users = await User.paginate(20);
        return UserResource.collection(users);
    }

    // GET /users/:id
    public async show(request: Request, response: Response) {
        const user = await User.findOrFail(request.params.id);
        return new UserResource(user);
    }

    // POST /users
    public async store(request: Request, response: Response) {
        const user = await User.create(request.body);
        return new UserResource(user).withStatus(201);
    }
}
```

---

## API Reference

### `Resource`

| Method | Description |
| :--- | :--- |
| `new UserResource(model)` | Creates an instance for a single resource |
| `UserResource.make(model)` | Alias for `new UserResource(model)` |
| `UserResource.collection(data)` | Creates a collection from an array or paginate result |
| `.additional(data)` | Adds extra fields to the top level of the response |
| `.withStatus(code)` | Overrides the HTTP status code |
| `Resource.wrap(key)` | Sets the global wrap key (default: `"data"`) |
| `Resource.withoutWrapping()` | Disables wrapping globally |

### `ResourceCollection`

| Method | Description |
| :--- | :--- |
| `new UserResourceCollection(data)` | Creates a dedicated collection |
| `.additional(data)` | Adds extra fields to the top level of the response |
| `.withStatus(code)` | Overrides the HTTP status code |

### CLI

| Command | Description |
| :--- | :--- |
| `npx strux make:resource UserResource` | Creates a resource class |
| `npx strux make:resource UserResource --collection` | Creates a resource + collection class |