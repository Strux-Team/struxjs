# Upgrade Guide

This guide provides step-by-step instructions for upgrading existing StruxJS projects to newer framework versions, covering dependency management, version-specific changes, and post-upgrade verification.

---

## General Upgrade Workflow

Upgrading a StruxJS application consists of updating your core dependencies, clearing compiled artifacts, recompiling TypeScript, and running tests.

### 1. Check Current Version

Inspect the version of `struxjs-core` currently installed in your project:

```bash
npm list struxjs
# or
npm list struxjs-core
```

### 2. Update Core Framework

StruxJS projects created via `create-strux-app` alias `struxjs-core` to `struxjs` in `package.json`:

```json
"dependencies": {
  "struxjs": "npm:struxjs-core@^1.0.9"
}
```

To update to the latest release, run the appropriate command for your package manager:

::: code-group

```bash [npm]
# If using the default alias 'struxjs':
npm install struxjs@npm:struxjs-core@latest

# Or if you installed 'struxjs-core' directly:
npm install struxjs-core@latest
```

```bash [pnpm]
# If using the default alias 'struxjs':
pnpm add struxjs@npm:struxjs-core@latest

# Or if you installed 'struxjs-core' directly:
pnpm add struxjs-core@latest
```

```bash [yarn]
# If using the default alias 'struxjs':
yarn add struxjs@npm:struxjs-core@latest

# Or if you installed 'struxjs-core' directly:
yarn add struxjs-core@latest
```

:::

Alternatively, you can manually update the version number in your `package.json` and run `npm install`:

```json
{
  "dependencies": {
    "struxjs": "npm:struxjs-core@^1.0.9"
  }
}
```

### 3. Clear Cache and Rebuild

After updating packages, clear any previous compiled artifacts in `dist/` and recompile TypeScript:

```bash
# Remove build artifacts
rm -rf dist

# Recompile TypeScript
npm run build
```

### 4. Verify & Test

Run your test suite and verify the application boots properly:

```bash
# Run tests (if configured)
npm test

# Start in development mode
npm run dev
```

---

## Upgrading to v1.0.9 (from v1.0.8)

### High Impact Highlights

- **Zero Breaking Changes**: Fully backward compatible with `1.0.8`.
- **IoC Container Resolution Caching**: Constructor dependency plans are now cached using a `WeakMap`. Repetitive reflection and regex parameter extraction during class resolution are eliminated.
- **Router Action Parameter Caching**: Controller action parameter resolvers are pre-compiled and cached on first invocation, significantly reducing routing overhead on subsequent HTTP requests.

### Optional: Adding ESLint to Existing Projects

Starting in `1.0.9`, the official StruxJS project template includes ESLint (Flat Config) configured for TypeScript. If your existing project does not yet have ESLint configured, you can add it as follows:

#### 1. Install ESLint dependencies

```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

#### 2. Create `eslint.config.js` in your project root

```javascript
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "resources/**",
      "storage/**",
    ],
  },
  {
    files: ["app/**/*.ts", "config/**/*.ts", "routes/**/*.ts", "database/**/*.ts", "bootstrap*.ts", "*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "args": "none", "varsIgnorePattern": "^_" }],
      "no-console": "off",
      "no-empty": ["error", { "allowEmptyCatch": true }],
    },
  },
];
```

#### 3. Add lint scripts to `package.json`

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

---

## Upgrading to v1.0.8 (from v1.0.7)

### Authentication & Token Security Updates

#### 1. Strict Token Type Separation
In `1.0.8`, access tokens are signed with `type: "access"`, and refresh tokens are signed with `type: "refresh"`.
- The `ApiAuthMiddleware` and `JwtGuard.resolveRequestPayload()` automatically reject requests if a client attempts to pass a Refresh Token to an endpoint expecting an Access Token.
- If your frontend previously reused refresh tokens in `Authorization: Bearer <token>` headers on regular API routes, ensure your frontend client correctly routes the **access token** for standard API requests and reserves the **refresh token** exclusively for token refresh endpoints (`/auth/refresh`).

#### 2. Shared JTI and Token Rotation
When calling `JwtGuard.issueTokenPair(user)`:
- Both access and refresh tokens share the same `jti` identifier.
- When `refreshToken(oldRefreshToken, { rotation: true })` is invoked, the previous `jti` is blacklisted. This immediately revokes the associated access token as well, mitigating replay attack risks.

#### 3. Redis TTL String Parsing
TTL configuration values in `.env` or configurations can now safely use string notation:
- Values such as `JWT_REFRESH_TTL=30d`, `JWT_EXPIRES_IN=1h`, `"15m"`, or `"60s"` are automatically parsed to positive integers by `parseTtlToSeconds()`, preventing Redis errors like `ERR value is not an integer or out of range`.

#### 4. Global Redis Prefix
The JWT blacklist and refresh token stores now respect `REDIS_PREFIX` defined in `.env` (e.g. `REDIS_PREFIX=strux_`), keeping Redis keys organized and collision-free across multiple environments.

---

## Troubleshooting & FAQs

### Package resolution issues
If your package manager fails to resolve the aliased package:
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### TypeScript build errors after upgrade
Ensure your `dist/` directory is deleted before compiling, as outdated `.d.ts` or `.js` files might conflict:
```bash
rm -rf dist
npm run build
```

### Verifying Environment Variables
Whenever upgrading between minor or major versions, check if new configuration options are available in `.env.example` of the latest StruxJS template (e.g., Redis prefixes or JWT TTL formats).
