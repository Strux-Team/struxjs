# HTTP Response

The `Response` object represents outgoing HTTP responses. StruxJS decorates Fastify's reply object with expressive methods for returning JSON, rendering HTML templates, setting status codes, downloading files, streaming real-time events, managing cookies, and building fluent HTTP redirects.

---

## Accessing the Response Object

The `Response` object can be accessed in three ways:

### 1. Action Parameter Injection (Recommended)

Type-hint `Response` in Controller action methods:

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async index(request: Request, response: Response) {
        return response.json({ status: "success" });
    }
}
```

### 2. Global Helper Function (`response()`)

Call the `response()` helper within request context:

```typescript
import { response } from "struxjs";

return response().json({ message: "Success" });
```

---

## Response Methods

### `res.json(data)`
Sends a JSON response with an `application/json` header and HTTP 200 status code (or active status code):

```typescript
return response.json({
    success: true,
    data: [ { id: 1, name: "Alice" } ]
});
```

### `res.send(data)`
Sends a raw String, Buffer, Object, or Stream payload to the client.

```typescript
return response.send("<h1>Hello World</h1>");
```

### `res.view(template, data?)`
Renders a server-side `.strux` HTML view template located in `resources/views/`:

```typescript
return response.view("users.index", { users });
```

### `res.status(code)` / `res.code(code)`
Sets the HTTP response status code (e.g. `200`, `201`, `400`, `404`, `500`). Supports chaining:

```typescript
return response.status(201).json({ message: "User created" });
```

### `res.header(name, value)`
Sets a custom HTTP header on the outgoing response:

```typescript
return response.header("X-Custom-Header", "StruxJS").json({ ok: true });
```

### `res.type(contentType)`
Sets the `Content-Type` header (e.g. `application/pdf`, `text/html`):

```typescript
return response.type("application/pdf").send(pdfBuffer);
```

---

## File Downloads & File Streaming

### `res.download(filePath, filename?, headers?)`
Streams a file as an HTTP Attachment download:

* `filePath`: Absolute or relative path to file.
* `filename`: Optional custom download filename presented to the client.
* `headers`: Optional key-value object of custom HTTP headers.

```typescript
return response.download("storage/app/reports/monthly.pdf", "April_Report.pdf");
```

### `res.file(filePath, contentType?)`
Streams a file directly to the client browser for inline display (e.g. previewing images or PDFs):

```typescript
return response.file("storage/app/public/avatars/user.png");
```

### `res.stream(readableStream, filename?, contentType?)`
Streams a Node.js `Readable` stream directly to the client:

```typescript
import fs from "fs";

const readable = fs.createReadStream("large_archive.zip");
return response.stream(readable, "archive.zip", "application/zip");
```

---

## Server-Sent Events (SSE)

### `res.sse(callback)`
Initializes a real-time Server-Sent Events (SSE) stream (`text/event-stream`) for pushing server events to the client:

```typescript
return response.sse((send, close) => {
    // Send event data payload
    send({ time: new Date() }, "update", "id-1");

    // Close stream when done
    // close();
});
```

---

## Cookies Management

### `res.cookie(name, value, options?)`
Sets an encrypted, HTTP-only, SameSite cookie:

```typescript
response.cookie("theme", "dark", {
    maxAge: 86400 * 30, // 30 days in seconds
    httpOnly: true,
    sameSite: "lax"
});
```

### `res.clearCookie(name, options?)`
Invalidates and deletes a cookie on the client browser:

```typescript
response.clearCookie("theme");
```

---

## HTTP Redirects (`res.redirect()`)

Calling `response.redirect()` returns a `RedirectResponse` instance supporting fluent method chaining.

### 1. Direct URL Redirect

```typescript
return response.redirect("/login");
```

Or fluently:

```typescript
return response.redirect().to("/dashboard", 302);
```

### 2. Named Route Redirect (`.route()`)

Redirects to a named route, automatically binding parameters and query strings:

```typescript
// Route: /users/:id
return response.redirect().route("users.show", { id: 42 });

// Route with query parameters: /users/42?tab=activity
return response.redirect().route("users.show", { id: 42 }, { tab: "activity" });
```

### 3. Back Redirect (`.back()`)

Redirects the user back to their previous page using the HTTP `Referer` header:

```typescript
return response.redirect().back();
```

With fallback URL if no referer header is present:

```typescript
return response.redirect().back("/home");
```

### 4. Flashing Data to Session (`.with()`)

Flashes key-value data to Session for the next HTTP request:

```typescript
return response.redirect()
    .route("users.index")
    .with("success", "User profile updated successfully!");
```

### 5. Flashing Form Input (`.withInput()`)

Flashes previous form input payload to Session so `old()` helper can restore field values:

```typescript
return response.redirect()
    .back()
    .withInput();
```

### 6. Flashing Validation Errors (`.withErrors()`)

Flashes validation errors to Session for the `errors` view helper:

```typescript
return response.redirect()
    .back()
    .withInput()
    .withErrors({ email: ["Email address is invalid."] });
```
