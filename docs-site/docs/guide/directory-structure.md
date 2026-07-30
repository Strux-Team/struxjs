# Directory Structure

This page provides an overview of the application file layout and directory structure in a standard StruxJS application.

---

## Directory Tree Overview

```
my-app/
├── app/
│   ├── Console/
│   ├── Controllers/
│   ├── Events/
│   ├── Jobs/
│   ├── Listeners/
│   ├── Mail/
│   ├── Middleware/
│   ├── Models/
│   ├── Providers/
│   ├── Requests/
│   ├── Resources/
│   └── Services/
├── config/
│   ├── app.ts
│   ├── cache.ts
│   ├── database.ts
│   ├── logging.ts
│   ├── mail.ts
│   ├── queue.ts
│   ├── redis.ts
│   └── session.ts
├── database/
│   ├── factories/
│   ├── migrations/
│   └── seeders/
├── public/
├── resources/
│   ├── css/
│   ├── js/
│   └── views/
├── routes/
│   ├── api.ts
│   ├── console.ts
│   ├── events.ts
│   └── web.ts
├── storage/
│   ├── app/
│   ├── framework/
│   └── logs/
├── .env
├── bootstrap.ts
├── bootstrap-cli.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Root Directories

### `app/`
The `app` directory contains the core application codebase. All classes inside `app/` are managed by the StruxJS IoC Container and support Dependency Injection.

* `app/Console/`: Custom CLI artisan commands.
* `app/Controllers/`: HTTP Controllers that handle incoming web and API requests.
* `app/Events/`: Event classes dispatched throughout the application.
* `app/Jobs/`: Queueable job classes executed asynchronously by background workers.
* `app/Listeners/`: Listener classes responding to dispatched events.
* `app/Mail/`: Mailable classes for composing HTML/text emails.
* `app/Middleware/`: HTTP Middleware filters for request preprocessing and authorization.
* `app/Models/`: Data models and entity abstractions.
* `app/Providers/`: Service Provider classes for registering IoC container bindings and booting services.
* `app/Requests/`: Form Request classes for payload validation and authorization rules.
* `app/Resources/`: API Transformer classes for formatting JSON responses.
* `app/Services/`: Business logic service layer classes.

### `config/`
The `config` directory contains all configuration files for framework services:

* `app.ts`: Application name, environment mode, time zone, locale, and registered Service Providers.
* `cache.ts`: Cache drivers (File, Memory, Redis) and TTL defaults.
* `database.ts`: Connection profiles for SQL (SQLite, MySQL, PostgreSQL) and MongoDB.
* `logging.ts`: Log channels, rotation settings, and log levels.
* `mail.ts`: SMTP and log mailer configurations.
* `queue.ts`: Queue driver configurations and retry policies.
* `redis.ts`: Redis connection parameters and key prefixes.
* `session.ts`: Session storage driver and cookie security configurations.

### `database/`
Contains database schema migrations, seeders, and model factories:

* `factories/`: Model Factory classes for generating dummy data structures for testing and seeding.
* `migrations/`: Schema migration files defining database table structures over time.
* `seeders/`: Seeder classes for populating initial or test data into the database.

### `public/`
The web server document root directory. Contains static assets such as images, favicon, and compiled CSS/JavaScript files.

### `resources/`
Contains uncompiled frontend assets and view templates:

* `resources/css/`: Source CSS / Tailwind CSS stylesheet files.
* `resources/js/`: Client-side JavaScript source modules.
* `resources/views/`: Server-rendered `.strux` HTML template files.

### `routes/`
Contains all application route definitions:

* `web.ts`: Web routes configured with Session and CSRF protection enabled.
* `api.ts`: Stateless REST API routes automatically prefixed with `/api`.
* `console.ts`: CLI Artisan command definitions and background task schedules.
* `events.ts`: Global event-listener bindings.

### `storage/`
Contains generated files, framework caches, sessions, and logs:

* `storage/app/`: Storage location for uploaded files and internal application storage.
* `storage/framework/`: File-based session files, cache files, and queue job files.
* `storage/logs/`: Daily rotating application log files.

---

## Root Files

* `.env`: Environment configuration file containing local environment variables and secrets.
* `bootstrap.ts`: HTTP application entry point that initializes the IoC container, registers routes, and boots the HTTP server.
* `bootstrap-cli.ts`: Entry point for executing CLI artisan commands.
* `package.json`: Project manifest defining dependencies, scripts, and package metadata.
* `tsconfig.json`: TypeScript compiler options and path aliases.
* `vite.config.ts`: Configuration file for the Vite asset compiler.

---

## Quick Reference

* **Add HTTP Endpoint**: Create a method in `app/Controllers/` and register a route in `routes/web.ts` or `routes/api.ts`.
* **Add Middleware**: Create a middleware in `app/Middleware/` and attach it using `.middleware()` in routes.
* **Add Background Job**: Create a job in `app/Jobs/` and dispatch it using `dispatch()`.
* **Configure Environment Variables**: Add keys to `.env` and reference them via `config()` or `process.env`.
