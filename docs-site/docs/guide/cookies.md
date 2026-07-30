# Cookies

StruxJS provides a simple API for reading and writing HTTP cookies. By default, all cookies written via `response.cookie()` are **automatically encrypted** using `AES-256-GCM` before being sent to the browser. Incoming cookies are automatically decrypted when read via `request.cookie()`.

---

## Application Key

Cookie encryption depends on the `APP_KEY` environment variable. Without a valid key, cookies use a fallback value and are not securely encrypted.

### Generating a key

```bash
npx strux key:generate
```

This generates a cryptographically random 32-byte key encoded as `base64:...` and writes it directly to your `.env` file:

```ini
APP_KEY=base64:xG4k2...
```

If `.env` does not exist yet, the command creates it from `.env.example` (if available) or creates a new `.env` with just the key. If `APP_KEY` already exists, it is replaced.

To print the generated key without writing to `.env`:

```bash
npx strux key:generate --show
```

::: warning
Changing `APP_KEY` in production will invalidate all existing encrypted cookies and sessions. Generate the key once and keep it stable.
:::

---

## How Encryption Works

When `response.cookie()` is called, the value is encrypted before being stored in the browser using:

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** `SHA-256` hash of `APP_KEY`
- **IV:** 12 random bytes generated per cookie write
- **Format:** `e:<iv_hex>.<tag_hex>.<ciphertext_hex>`

The `e:` prefix allows `request.cookie()` to automatically detect encrypted values and decrypt them transparently before returning.

If a cookie value does not start with `e:`, it is returned as-is (plain text).

---

## Writing Cookies

Use `response.cookie(name, value, options?)` inside a controller action:

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async login(request: Request, response: Response) {
        // Encrypted by default
        response.cookie("user_token", "abc123");

        return response.json({ ok: true });
    }
}
```

### Cookie options

The third argument accepts any standard cookie option:

```typescript
response.cookie("user_token", "abc123", {
    maxAge: 60 * 60 * 24 * 7,  // 7 days in seconds
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    domain: ".example.com",
});
```

Default options applied automatically when not overridden:

| Option | Default |
| :--- | :--- |
| `path` | `"/"` |
| `httpOnly` | `true` |
| `sameSite` | `"lax"` |

### Disabling encryption

Pass `encrypt: false` to skip encryption and store the raw value:

```typescript
response.cookie("theme", "dark", { encrypt: false });
```

---

## Reading Cookies

Use `request.cookie(name, defaultValue?)` to retrieve a cookie value. Encrypted values are decrypted automatically:

```typescript
export class UserController {
    public async profile(request: Request, response: Response) {
        const token = request.cookie("user_token");
        const theme = request.cookie("theme", "light"); // with default
    }
}
```

If the cookie does not exist, `defaultValue` is returned (or `undefined` if not provided).

---

## Deleting Cookies

Use `response.clearCookie(name, options?)` to remove a cookie from the browser:

```typescript
export class UserController {
    public async logout(request: Request, response: Response) {
        response.clearCookie("user_token");

        return response.redirect("/login");
    }
}
```

Pass options to match the path or domain of the original cookie if it was set with non-default values:

```typescript
response.clearCookie("user_token", { path: "/app", domain: ".example.com" });
```

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `npx strux key:generate` | Generate `APP_KEY` and write it to `.env` |
| `npx strux key:generate --show` | Print the generated key without modifying `.env` |
