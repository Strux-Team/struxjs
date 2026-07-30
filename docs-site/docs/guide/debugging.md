# Debugging & Dump Helpers

StruxJS provides Laravel-inspired `dump()` and `dd()` (Dump and Die) debugging helpers for rapid inspection of variables, Eloquent models, collections, query builders, and application state.

---

## 1. Overview

- **`dump(...args)`**: Dumps one or multiple variables without interrupting application execution flow.
- **`dd(...args)`**: Dumps variables and immediately halts execution (Dump and Die).

Both helpers adapt their output format dynamically based on the execution context:
- **Web Browser (HTML Request)**: Renders a dark-mode interactive tree view with collapsible nested objects, string lengths, syntax color coding, and exact caller file location (e.g. `routes/web.ts:78`).
- **API Client (JSON Request)**: Returns a `500 Internal Server Error` JSON payload containing the caller location and serialized data.
- **CLI / Terminal (Queue Worker, Console Commands)**: Prints colored, formatted output via `util.inspect` and exits the process with code `1` (for `dd`).

---

## 2. Usage

### Importing Helpers

```typescript
import { dd, dump } from "struxjs";

// Dump and continue execution
dump(variable1, variable2);

// Dump and halt execution immediately
dd(variable1, variable2);
```

### Global Access

Both functions are attached to `globalThis`, enabling direct usage without explicit imports:

```typescript
// Available globally across controllers, routes, jobs, and models
dd(user, "DEBUG_CHECK");
```

---

## 3. Eloquent Model, Collection & Query Debugging

Eloquent Models, Collections, and Query Builders feature built-in `.dump()` and `.dd()` instance methods.

### Debugging Eloquent Models

```typescript
const user = await User.findOrFail(1);

// Dump model instance attributes
user.dump();

// Dump model instance attributes and stop execution
user.dd();
```

### Debugging Collections

```typescript
const users = await User.where("status", "active").get();

// Dump collection items
users.dump();

// Dump collection items and stop execution
users.dd();
```

### Debugging SQL Queries

Call `.dd()` or `.dump()` directly on an `EloquentBuilder` instance to inspect the compiled SQL query string and parameter bindings:

```typescript
// Dumps { sql: "select * from `users` where `status` = ?", bindings: ["active"] }
User.where("status", "active").dd();
```

---

## 4. Response Behavior Matrix

| Context | Function | Behavior |
| :--- | :--- | :--- |
| **Web Request** | `dump()` | Logs output to terminal, continues HTTP execution. |
| **Web Request** | `dd()` | Halts HTTP execution, renders dark-mode HTML tree view with file caller header (`500`). |
| **API Request** | `dd()` | Halts HTTP execution, returns JSON payload `{ dd: true, caller: "...", data: ... }` (`500`). |
| **CLI / Worker** | `dd()` | Logs red location header + colored inspection to stdout, calls `process.exit(1)`. |
