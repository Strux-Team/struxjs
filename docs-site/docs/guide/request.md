# HTTP Request

The `Request` object represents incoming HTTP requests. StruxJS decorates Fastify's request object with expressive helpers for retrieving input parameters, headers, cookies, uploaded files, session state, and client metadata.

---

## Accessing the Request Object

The `Request` object can be accessed in three ways:

### 1. Action Parameter Injection (Recommended)

Type-hint `Request` in Controller action methods:

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async store(request: Request, response: Response) {
        const name = request.input("name");
        return response.json({ name });
    }
}
```

### 2. Global Helper Function (`request()`)

Call the `request()` helper within request context:

```typescript
import { request } from "struxjs";

const currentPath = request().path();
```

---

## Input Retrieval Methods

### `req.all()`
Returns an object combining route path parameters (`params`), URL query parameters (`query`), and request body payload (`body`) into a single key-value dictionary (excluding raw file buffers).

```typescript
const allInputs = request.all();
```

### `req.input(key, defaultValue?)`
Retrieves a single input item by key from `req.all()`. Returns `defaultValue` (default `undefined`) if the key does not exist.

```typescript
const search = request.input("search", "default_keyword");
```

### `req.only(...keys)`
Retrieves a filtered object containing only the specified input keys:

```typescript
const credentials = request.only("email", "password");
```

### `req.except(...keys)`
Retrieves all request inputs except the specified keys:

```typescript
const data = request.except("credit_card", "cvv");
```

### `req.has(key)`
Returns `true` if the specified key exists in request input and is not `null` or `undefined`:

```typescript
if (request.has("promo_code")) {
    // Process promo code
}
```

### `req.old(key?, defaultValue?)`
Retrieves flashed input data from previous request session (used after validation redirects):

```typescript
const previousEmail = request.old("email", "user@example.com");
```

### `req.validate(rules, customMessages?, customAttributes?)`
Executes asynchronous validation on the request payload:

```typescript
const validated = await request.validate({
    email: "required|email",
    password: "required|min:6"
});
```

---

## Route Parameters & Query Strings

### `req.params`
An object containing named URL path parameters:

```typescript
// Route: /users/:id
const userId = request.params.id;
```

### `req.query`
An object containing parsed URL query string parameters:

```typescript
// Request: /users?sort=asc&page=2
const { sort, page } = request.query;
```

### `req.body`
The parsed JSON or Form request body payload object.

---

## File Uploads

StruxJS wraps file uploads into `UploadedFile` instances.

### `req.file(key)`
Retrieves a single `UploadedFile` instance for the given field name. Returns `null` if no file was uploaded:

```typescript
const avatar = request.file("avatar");

if (avatar && avatar.isValid()) {
    await avatar.move("public/uploads", "avatar.png");
}
```

### `req.files(key?)`
Retrieves an array of `UploadedFile` instances for multiple uploads under `key` (or all uploaded files if no key is provided):

```typescript
const photos = request.files("photos");
```

### `req.hasFile(key)`
Returns `true` if a valid file was uploaded for the specified field name:

```typescript
if (request.hasFile("document")) {
    // Process uploaded document
}
```

---

## Cookies & Session

### `req.cookie(name, defaultValue?)`
Retrieves an HTTP cookie by name. Decrypts encrypted cookies and verifies signed cookies using application secret `APP_KEY` automatically.

```typescript
const sessionToken = request.cookie("session_token");
```

### `req.session()`
Returns the active `SessionStore` instance for inspecting and managing HTTP session data.

```typescript
const session = request.session();
session.put("theme", "dark");
```

---

## Headers & Client Metadata

### `req.header(name, defaultValue?)`
Retrieves an HTTP header value by case-insensitive header name:

```typescript
const userAgent = request.header("user-agent");
```

### `req.path()`
Returns the current request URL path excluding query strings:

```typescript
// URL: /users/list?sort=asc -> returns "/users/list"
const path = request.path();
```

### `req.fullUrl()`
Returns the complete URL including protocol, domain host, path, and query string:

```typescript
const fullUrl = request.fullUrl();
```

### `req.ip`
Client IP address.

### `req.method`
HTTP request method string (`GET`, `POST`, `PUT`, `DELETE`, etc.).

### `req.isMethod(method)`
Returns `true` if the HTTP request method matches `method` (case-insensitive):

```typescript
if (request.isMethod("POST")) {
    // Handle POST
}
```

### `req.wantsJson()`
Returns `true` if the client requests a JSON response (via `Accept: application/json` header, `X-Requested-With: XMLHttpRequest`, or `/api/*` route URL).

### `req.isJson()`
Returns `true` if the incoming request `Content-Type` header is `application/json`.

### `req.ajax()`
Returns `true` if the request was sent via AJAX (`X-Requested-With: XMLHttpRequest`).

### `req.bearerToken()`
Retrieves the Bearer authentication token from the `Authorization` header. Returns `null` if not present:

```typescript
const token = request.bearerToken();
```

---

## Authentication & User Context

### `req.user<T>()`
Returns the currently authenticated user model instance attached to the request context (or `null` if unauthenticated).

```typescript
const user = request.user<User>();
```

### `req.setUser(user)`
Sets the authenticated user instance on the active request context.
