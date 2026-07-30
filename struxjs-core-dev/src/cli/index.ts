#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import crypto from "crypto";
import dotenv from "dotenv";

try {
    const { register } = await import("node:module");
    register("tsx", pathToFileURL("./"));
} catch { }

dotenv.config({ path: path.join(process.cwd(), ".env") });

const program = new Command();

program
    .name("strux")
    .description("StruxJS Framework Official Command Line Interface")
    .version("1.1.0");

/**
 * Helper to parse nested input names (e.g., 'Admin/User' or 'Api/V1/Product')
 * Returns the absolute directory path and the final clean PascalCase name.
 */
function parseTargetLocation(baseFolder: string, inputName: string) {
    const normalizedInput = inputName.replace(/\\/g, "/");
    const parts = normalizedInput.split("/");

    const rawClassName = parts.pop()!;
    const subFolders = parts;

    const cleanClassName = rawClassName.charAt(0).toUpperCase() + rawClassName.slice(1);
    const targetDir = path.join(process.cwd(), "app", baseFolder, ...subFolders);

    return { targetDir, cleanClassName };
}

/**
 * Helper to parse view/layout template locations in resources/views/
 * Supports dot notation like 'users.index' or slash paths like 'admin/dashboard'
 */
function parseViewPath(inputName: string, defaultSubfolder = "") {
    const normalizedInput = inputName.replace(/\./g, "/").replace(/\\/g, "/");
    const parts = normalizedInput.split("/").filter(Boolean);

    let fileName = parts.pop()!;
    if (fileName.endsWith(".strux")) {
        fileName = fileName.slice(0, -6);
    }

    const subFolders = parts;
    const baseDir = defaultSubfolder ? path.join(process.cwd(), "resources", "views", defaultSubfolder) : path.join(process.cwd(), "resources", "views");
    const targetDir = path.join(baseDir, ...subFolders);
    const targetFile = path.join(targetDir, `${fileName}.strux`);
    const displayRelPath = path.relative(process.cwd(), targetFile);

    return { targetDir, fileName, targetFile, displayRelPath };
}

/**
 * Boot database connection dynamically for CLI commands
 */
async function bootDatabaseConfig() {
    const configPath = path.join(process.cwd(), "config", "database.ts");
    const jsConfigPath = path.join(process.cwd(), "config", "database.js");

    let dbConfig: any = {};
    if (fs.existsSync(configPath)) {
        const mod = await import(pathToFileURL(configPath).href);
        dbConfig = mod.default || mod;
    } else if (fs.existsSync(jsConfigPath)) {
        const mod = await import(pathToFileURL(jsConfigPath).href);
        dbConfig = mod.default || mod;
    } else {
        dbConfig = {
            driver: process.env.DB_DRIVER || "sqlite3",
            connection: { filename: ":memory:" }
        };
    }

    const { BaseModel } = await import("../core/database/BaseModel.js");
    await BaseModel.bootConnection(dbConfig);
}

/**
 * Command: npx strux key:generate
 */
program
    .command("key:generate")
    .description("Set the application key (APP_KEY) in .env file")
    .option("--show", "Display the key instead of modifying the .env file")
    .action((options: { show?: boolean }) => {
        const generatedKey = `base64:${crypto.randomBytes(32).toString("base64")}`;

        if (options.show) {
            console.log(`\x1b[32m[StruxJS CLI]: APP_KEY=${generatedKey}\x1b[0m`);
            return;
        }

        const envPath = path.join(process.cwd(), ".env");
        if (!fs.existsSync(envPath)) {
            const envExamplePath = path.join(process.cwd(), ".env.example");
            if (fs.existsSync(envExamplePath)) {
                fs.copyFileSync(envExamplePath, envPath);
            } else {
                fs.writeFileSync(envPath, `APP_KEY=${generatedKey}\n`);
                console.log(`\x1b[32m[StruxJS CLI Success]: Created .env and set APP_KEY [${generatedKey}].\x1b[0m`);
                return;
            }
        }

        let content = fs.readFileSync(envPath, "utf8");
        if (content.includes("APP_KEY=")) {
            content = content.replace(/^APP_KEY=.*$/m, `APP_KEY=${generatedKey}`);
        } else {
            content += `\nAPP_KEY=${generatedKey}\n`;
        }

        fs.writeFileSync(envPath, content, "utf8");
        console.log(`\x1b[32m[StruxJS CLI Success]: Application key [${generatedKey}] set successfully in .env.\x1b[0m`);
    });

/**
 * Command: npx strux route:list (or npx strux route:l)
 */
program
    .command("route:list")
    .alias("route:l")
    .description("List all registered application routes in a formatted table")
    .action(async () => {
        try {
            const { Application, HttpServiceProvider, Route } = await import("../index.js");

            const app = new Application(process.cwd());
            await app.bootstrap();

            const httpProvider = new HttpServiceProvider(app.container);
            httpProvider.register();

            await Route.loadRoutes(process.cwd());

            const routes = Route.getRoutes();

            if (routes.length === 0) {
                console.log("\x1b[33m[StruxJS CLI]: No routes registered.\x1b[0m");
                return;
            }

            const colorMethod = (method: string) => {
                switch (method.toUpperCase()) {
                    case "GET": return "\x1b[36mGET\x1b[0m";       // Cyan
                    case "POST": return "\x1b[33mPOST\x1b[0m";     // Yellow
                    case "PUT": return "\x1b[35mPUT\x1b[0m";       // Magenta
                    case "PATCH": return "\x1b[35mPATCH\x1b[0m";   // Magenta
                    case "DELETE": return "\x1b[31mDELETE\x1b[0m"; // Red
                    default: return method;
                }
            };

            const rows = routes.map((r: any) => ({
                method: r.method,
                coloredMethod: colorMethod(r.method),
                uri: r.uri,
                name: r.name || "-",
                action: r.action,
                middleware: r.middlewares.length > 0 ? r.middlewares.join(", ") : "-"
            }));

            const headers = { method: "Method", uri: "URI", name: "Name", action: "Action", middleware: "Middleware" };
            const colWidths = {
                method: Math.max(headers.method.length, ...rows.map((r: any) => r.method.length)),
                uri: Math.max(headers.uri.length, ...rows.map((r: any) => r.uri.length)),
                name: Math.max(headers.name.length, ...rows.map((r: any) => r.name.length)),
                action: Math.max(headers.action.length, ...rows.map((r: any) => r.action.length)),
                middleware: Math.max(headers.middleware.length, ...rows.map((r: any) => r.middleware.length))
            };

            const pad = (str: string, length: number) => str.padEnd(length, " ");

            const divider = `+-${"-".repeat(colWidths.method)}-+-${"-".repeat(colWidths.uri)}-+-${"-".repeat(colWidths.name)}-+-${"-".repeat(colWidths.action)}-+-${"-".repeat(colWidths.middleware)}-+`;

            console.log(`\n\x1b[1m\x1b[32mStruxJS Registered Routes (${routes.length})\x1b[0m\n`);
            console.log(divider);
            console.log(`| \x1b[1m${pad(headers.method, colWidths.method)}\x1b[0m | \x1b[1m${pad(headers.uri, colWidths.uri)}\x1b[0m | \x1b[1m${pad(headers.name, colWidths.name)}\x1b[0m | \x1b[1m${pad(headers.action, colWidths.action)}\x1b[0m | \x1b[1m${pad(headers.middleware, colWidths.middleware)}\x1b[0m |`);
            console.log(divider);

            for (const row of rows) {
                const methodPadding = " ".repeat(colWidths.method - row.method.length);
                console.log(`| ${row.coloredMethod}${methodPadding} | ${pad(row.uri, colWidths.uri)} | ${pad(row.name, colWidths.name)} | ${pad(row.action, colWidths.action)} | ${pad(row.middleware, colWidths.middleware)} |`);
            }

            console.log(divider + "\n");
        } catch (err: any) {
            console.error("\x1b[31m[StruxJS CLI Error]: Failed to list routes:\x1b[0m", err.message || err);
        }
    });

/**
 * Command: npx strux make:controller <name>
 */
program
    .command("make:controller <name>")
    .description("Create a new controller class (supports nested folders like Admin/Dashboard)")
    .option("-r, --resource", "Generate a resource controller class containing standard CRUD methods")
    .action((name: string, options: { resource?: boolean }) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Controllers", name);

        const controllerName = cleanClassName.endsWith("Controller")
            ? cleanClassName
            : `${cleanClassName}Controller`;

        const targetFile = path.join(targetDir, `${controllerName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Controller '${controllerName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const resourceName = cleanClassName.replace(/Controller$/, "");

        const template = options.resource
            ? `import { Request, view } from "struxjs";

export class ${controllerName} {
    /**
     * Display a listing of the resource.
     */
    public async index() {
          return view("${resourceName.toLowerCase()}.index");
    }

    /**
     * Show the form for creating a new resource.
     */
    public async create(request: Request) {
        return view("${resourceName.toLowerCase()}.create");
    }

    /**
     * Store a newly created resource in storage.
     */
    public async store(request: Request) {
        //Logic
    }

    /**
     * Display the specified resource.
     */
    public async show(id: string) {
        return view("${resourceName.toLowerCase()}.show", { id });
    }

    /**
     * Show the form for editing the specified resource.
     */
    public async edit(id: string) {
        return view("${resourceName.toLowerCase()}.edit", { id });
    }

    /**
     * Update the specified resource in storage.
     */
    public async update(request: Request) {
        //Logic
    }

    /**
     * Remove the specified resource from storage.
     */
    public async destroy(id: string) {
        //Logic
    }
}
`
            : `import { Request, Response, view } from "struxjs";

export class ${controllerName} {
    public async index() {
        return view("${resourceName.toLowerCase()}.index");
    }
}
`;

        fs.writeFileSync(targetFile, template);
        console.log(`\x1b[32m[StruxJS CLI Success]: Controller created successfully at app/Controllers/${name.endsWith("Controller") ? name : name + "Controller"}.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:model <name>
 */
program
    .command("make:model <name>")
    .description("Create a new database model class (supports nested folders)")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Models", name);

        const tableName = `${cleanClassName.toLowerCase()}s`;
        const targetFile = path.join(targetDir, `${cleanClassName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Model '${cleanClassName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `import { BaseModel } from "struxjs";

export class ${cleanClassName} extends BaseModel {
    protected table = "${tableName}";
}
`;

        fs.writeFileSync(targetFile, template);
        console.log(`\x1b[32m[StruxJS CLI Success]: Model created successfully at app/Models/${name}.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:middleware <name>
 */
program
    .command("make:middleware <name>")
    .description("Create a new HTTP middleware class (supports nested folders)")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Middleware", name);

        const middlewareName = cleanClassName.endsWith("Middleware")
            ? cleanClassName
            : `${cleanClassName}Middleware`;

        const targetFile = path.join(targetDir, `${middlewareName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Middleware '${middlewareName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `import { Middleware, Request, Response } from "struxjs";

export class ${middlewareName} implements Middleware {
    public async handle(request: Request, response: Response): Promise<void> {
        // Your middleware gate logic here...
    }
}
`;

        fs.writeFileSync(targetFile, template);
        console.log(`\x1b[32m[StruxJS CLI Success]: Middleware created successfully at app/Middleware/${name.endsWith("Middleware") ? name : name + "Middleware"}.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:request <name>
 */
program
    .command("make:request <name>")
    .description("Create a new FormRequest validation class (supports nested folders)")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Requests", name);

        const requestName = cleanClassName.endsWith("Request")
            ? cleanClassName
            : `${cleanClassName}Request`;

        const targetFile = path.join(targetDir, `${requestName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: FormRequest '${requestName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `import { FormRequest } from "struxjs";

export class ${requestName} extends FormRequest {
    public rules(): Record<string, any> {
        return {
            // Define rules, e.g.: "email": "required|email"
        };
    }

    public messages(): Record<string, string> {
        return {};
    }

    public attributes(): Record<string, string> {
        return {};
    }
}
`;

        fs.writeFileSync(targetFile, template);
        const displayPath = name.endsWith("Request") ? name : name + "Request";
        console.log(`\x1b[32m[StruxJS CLI Success]: FormRequest created successfully at app/Requests/${displayPath}.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:view <name>
 */
program
    .command("make:view <name>")
    .description("Create a new .strux view template file (supports dot notation like users.index or admin/dashboard)")
    .action((name: string) => {
        const { targetDir, fileName, targetFile, displayRelPath } = parseViewPath(name);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: View '${displayRelPath}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const titleName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
        const template = `@extends("layouts/app")

@section("title", "${titleName}")

@section("content")
<div class="container">
    <h1>${titleName} View</h1>
    <p>This is your newly generated view template.</p>
</div>
@endsection
`;

        fs.writeFileSync(targetFile, template, "utf8");
        console.log(`\x1b[32m[StruxJS CLI Success]: View template created successfully at ${displayRelPath}\x1b[0m`);
    });

/**
 * Command: npx strux make:layout <name>
 */
program
    .command("make:layout <name>")
    .description("Create a new .strux layout template file inside resources/views/layouts/ (supports dot notation)")
    .action((name: string) => {
        const { targetDir, fileName, targetFile, displayRelPath } = parseViewPath(name, "layouts");

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Layout '${displayRelPath}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token }}">
    <title>@slot("title")</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #f8fafc; line-height: 1.5; }
        .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
    </style>
</head>
<body>
    <main class="container">
        @slot("content")
    </main>
</body>
</html>
`;

        fs.writeFileSync(targetFile, template, "utf8");
        console.log(`\x1b[32m[StruxJS CLI Success]: Layout template created successfully at ${displayRelPath}\x1b[0m`);
    });

/* -------------------------------------------------------------------------- */
/*                         DATABASE MIGRATION CLI COMMANDS                    */
/* -------------------------------------------------------------------------- */

/**
 * Command: npx strux make:migration <name>
 */
program
    .command("make:migration <name>")
    .description("Create a new database migration file (e.g. create_users_table)")
    .action(async (name: string) => {
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const filePath = Migrator.make(name);
        const relPath = path.relative(process.cwd(), filePath);
        console.log(`\x1b[32m[StruxJS CLI Success]: Created Migration at ${relPath}\x1b[0m`);
    });

/**
 * Command: npx strux migrate
 */
program
    .command("migrate")
    .description("Run all pending database migrations")
    .action(async () => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        await migrator.run();
        process.exit(0);
    });

/**
 * Command: npx strux migrate:rollback
 */
program
    .command("migrate:rollback")
    .description("Rollback the last batch of database migrations")
    .option("--step <number>", "Number of batches to roll back", "1")
    .action(async (options: { step: string }) => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        const steps = Math.max(1, parseInt(options.step, 10) || 1);
        await migrator.rollback(steps);
        process.exit(0);
    });

/**
 * Command: npx strux migrate:reset
 */
program
    .command("migrate:reset")
    .description("Rollback all database migrations")
    .action(async () => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        await migrator.reset();
        process.exit(0);
    });

/**
 * Command: npx strux migrate:refresh
 */
program
    .command("migrate:refresh")
    .description("Reset and re-run all database migrations")
    .action(async () => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        await migrator.refresh();
        process.exit(0);
    });

/**
 * Command: npx strux migrate:fresh
 */
program
    .command("migrate:fresh")
    .description("Drop all database tables and re-run all migrations from scratch")
    .option("--seed", "Run seeders after completing migration")
    .action(async (options: { seed?: boolean }) => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        await migrator.fresh();
        if (options.seed) {
            const { SeederRunner } = await import("../core/database/seeders/SeederRunner.js");
            const runner = new SeederRunner();
            await runner.run("DatabaseSeeder");
        }
        process.exit(0);
    });

/**
 * Command: npx strux migrate:status
 */
program
    .command("migrate:status")
    .description("Show status of all database migrations")
    .action(async () => {
        await bootDatabaseConfig();
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const migrator = new Migrator();
        await migrator.status();
        process.exit(0);
    });

/* -------------------------------------------------------------------------- */
/*                            DATABASE SEEDER COMMANDS                        */
/* -------------------------------------------------------------------------- */

/**
 * Command: npx strux make:seeder <name>
 */
program
    .command("make:seeder <name>")
    .description("Create a new Seeder class file (e.g. UserSeeder)")
    .action(async (name: string) => {
        const { SeederRunner } = await import("../core/database/seeders/SeederRunner.js");
        const filePath = SeederRunner.make(name);
        const relPath = path.relative(process.cwd(), filePath);
        console.log(`\x1b[32m[StruxJS CLI Success]: Created Seeder at ${relPath}\x1b[0m`);
    });

/**
 * Command: npx strux make:factory <name>
 */
program
    .command("make:factory <name>")
    .description("Create a new Factory class file (e.g. UserFactory)")
    .action(async (name: string) => {
        const { Factory } = await import("../core/database/factories/Factory.js");
        const filePath = Factory.makeFactory(name);
        const relPath = path.relative(process.cwd(), filePath);
        console.log(`\x1b[32m[StruxJS CLI Success]: Created Factory at ${relPath}\x1b[0m`);
    });

/**
 * Command: npx strux db:seed
 */
program
    .command("db:seed")
    .description("Run database seeders (Defaults to DatabaseSeeder)")
    .option("--class <class>", "Specify the seeder class to run", "DatabaseSeeder")
    .action(async (options: { class?: string }) => {
        await bootDatabaseConfig();
        const { SeederRunner } = await import("../core/database/seeders/SeederRunner.js");
        const runner = new SeederRunner();
        await runner.run(options.class || "DatabaseSeeder");
        process.exit(0);
    });

/**
 * Command: npx strux storage:link
 */
program
    .command("storage:link")
    .description("Create a symbolic link from [public/storage] to [storage/app/public]")
    .action(async () => {
        try {
            const targetDir = path.join(process.cwd(), "storage", "app", "public");
            const linkPath = path.join(process.cwd(), "public", "storage");
            const publicDir = path.join(process.cwd(), "public");

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }

            if (fs.existsSync(linkPath)) {
                console.log("\x1b[33m[StruxJS CLI]: The [public/storage] link already exists.\x1b[0m");
                return;
            }

            fs.symlinkSync(targetDir, linkPath, "junction");
            console.log("\x1b[32m[StruxJS CLI]: The [public/storage] link has been connected to [storage/app/public].\x1b[0m");
        } catch (error: any) {
            console.error("\x1b[31m[StruxJS CLI Error]: Failed creating storage link:\x1b[0m", error.message);
        }
    });

/* -------------------------------------------------------------------------- */
/*                          CUSTOM CONSOLE COMMANDS                           */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                              QUEUE COMMANDS                                */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                              CACHE COMMANDS                                */
/* -------------------------------------------------------------------------- */

/**
 * Command: npx strux cache:clear
 */
program
    .command("cache:clear")
    .description("Flush all items from the default cache store (or a named store)")
    .option("-s, --store <store>", "Named cache store to clear (default: the configured default store)")
    .action(async (options: { store?: string }) => {
        await bootApp();
        const { Cache } = await import("../core/cache/Cache.js");

        const storeName = options.store || "default";
        try {
            await (await Cache.resolveStore(options.store)).flush();
            console.log(`\x1b[32m[StruxJS Cache]: Store "${storeName}" flushed successfully.\x1b[0m`);
        } catch (err: any) {
            console.error(`\x1b[31m[StruxJS Cache Error]: ${err.message}\x1b[0m`);
            process.exit(1);
        }
        process.exit(0);
    });

/**
 * Command: npx strux cache:table
 * Generates a migration for the database cache driver.
 */
program
    .command("cache:table")
    .description("Create a migration file for the database cache driver")
    .option("--table <name>", "Cache table name", "cache")
    .action(async (options: { table: string }) => {
        const { Migrator } = await import("../core/database/migrations/Migrator.js");
        const filePath = Migrator.make(`create_${options.table}_table`);

        const schema = `import { Schema, Blueprint } from "struxjs";

export async function up(): Promise<void> {
    await Schema.create("${options.table}", (table: Blueprint) => {
        table.string("key", 255).primary();
        table.text("value").notNullable();
        table.bigInteger("expires_at").nullable().defaultTo(null).index();
    });
}

export async function down(): Promise<void> {
    await Schema.dropIfExists("${options.table}");
}
`;
        fs.writeFileSync(filePath, schema, "utf-8");
        const relPath = path.relative(process.cwd(), filePath);
        console.log(`\x1b[32m[StruxJS CLI]: Created migration: ${relPath}\x1b[0m`);
        console.log(`\x1b[36m[StruxJS CLI]: Run \`npx strux migrate\` to apply.\x1b[0m`);
        process.exit(0);
    });

/**
 * Command: npx strux make:event <name>
 */
program
    .command("make:event <name>")
    .description("Create a new Event class (e.g. UserRegistered)")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Events", name);

        const eventName = cleanClassName.endsWith("Event")
            ? cleanClassName
            : cleanClassName;   // Events don't require a suffix

        const targetFile = path.join(targetDir, `${eventName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Event '${eventName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `import { Event } from "struxjs";

export class ${eventName} extends Event {
    constructor(
        // public readonly user: User,
    ) {
        super();
    }
}
`;
        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Event created at ${relPath}\x1b[0m`);
        console.log(`\x1b[36m[StruxJS CLI]: Register it in routes/events.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:listener <name>
 */
program
    .command("make:listener <name>")
    .description("Create a new Listener class (e.g. SendWelcomeEmail)")
    .option("--event <event>", "Event class this listener handles")
    .option("--queued", "Mark listener as queued (runs in background)")
    .action((name: string, options: { event?: string; queued?: boolean }) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Listeners", name);

        const listenerName = cleanClassName.endsWith("Listener")
            ? cleanClassName
            : cleanClassName;   // Listeners don't require a suffix

        const targetFile = path.join(targetDir, `${listenerName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Listener '${listenerName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const eventClass = options.event || "Event";
        const eventImport = options.event
            ? `import { ${eventClass} } from "../Events/${eventClass}.js";`
            : `import { Event } from "struxjs";`;
        const queuedProps = options.queued
            ? `\n    public shouldQueue = true;\n    public queue       = "default";\n`
            : "";

        const template = `import { Listener } from "struxjs";
${eventImport}

export class ${listenerName} extends Listener {${queuedProps}
    public async handle(event: ${eventClass}): Promise<void> {
        // TODO: implement listener logic
    }

    public async failed(event: ${eventClass}, error: Error): Promise<void> {
        // Optional: handle permanent failure
    }
}
`;
        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Listener created at ${relPath}\x1b[0m`);
        console.log(`\x1b[36m[StruxJS CLI]: Register it in routes/events.ts\x1b[0m`);
    });

/**
 * Command: npx strux make:job <name>
 */
program
    .command("make:job <name>")
    .description("Create a new Job class (e.g. SendEmailJob)")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Jobs", name);

        const jobName = cleanClassName.endsWith("Job")
            ? cleanClassName
            : `${cleanClassName}Job`;

        const targetFile = path.join(targetDir, `${jobName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Job '${jobName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const template = `import { Job } from "struxjs";

export class ${jobName} extends Job {
    /** Target queue — override or pass at dispatch time. */
    public queue = "default";

    /** Max retries before the job is marked as failed. */
    public tries = 3;

    constructor(/* public readonly someProperty: string */) {
        super();
    }

    public async handle(): Promise<void> {
        // TODO: implement job logic
        console.log("[${jobName}] Executing...");
    }

    public async failed(error: Error): Promise<void> {
        // Optional: notify, clean up, etc. when all retries are exhausted
        console.error("[${jobName}] Permanently failed:", error.message);
    }
}
`;

        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Job created successfully at ${relPath}\x1b[0m`);
    });

/**
 * Command: npx strux queue:work
 */
program
    .command("queue:work")
    .description("Start a queue worker to process jobs")
    .option("-q, --queue <queue>", "Queue name to consume", "default")
    .option("-c, --connection <connection>", "Queue connection name from config")
    .option("--tries <number>", "Max retry attempts per job", "3")
    .option("--timeout <seconds>", "Per-job execution timeout in seconds", "60")
    .option("--sleep <seconds>", "Seconds to sleep when queue is empty", "3")
    .option("--stop-when-empty", "Stop worker when queue is empty")
    .action(async (options: {
        queue: string;
        connection?: string;
        tries: string;
        timeout: string;
        sleep: string;
        stopWhenEmpty?: boolean;
    }) => {
        // Boot the app so configs, DB and job classes are loaded
        try {
            await bootApp();
        } catch (err: any) {
            console.warn("[StruxJS CLI] Could not load bootstrap:", err.message);
        }

        const { QueueWorker } = await import("../core/queue/QueueWorker.js");

        const worker = new QueueWorker({
            queue: options.queue,
            connection: options.connection,
            maxTries: parseInt(options.tries, 10),
            timeout: parseInt(options.timeout, 10),
            sleep: parseInt(options.sleep, 10),
            stopWhenEmpty: !!options.stopWhenEmpty,
        });

        // Graceful shutdown on SIGTERM / SIGINT
        process.on("SIGTERM", () => worker.stop());
        process.on("SIGINT", () => { worker.stop(); });

        await worker.work();
        process.exit(0);
    });

/**
 * Command: npx strux queue:failed
 */
program
    .command("queue:failed")
    .description("List all failed jobs")
    .option("-q, --queue <queue>", "Filter by queue name")
    .option("-c, --connection <connection>", "Queue connection name")
    .action(async (options: { queue?: string; connection?: string }) => {
        try {
            const bootstrapDistPath = path.join(process.cwd(), "dist", "bootstrap.js");
            if (fs.existsSync(bootstrapDistPath)) {
                await import(pathToFileURL(bootstrapDistPath).href);
            }
        } catch { /* ignore */ }

        const { Queue } = await import("../core/queue/Queue.js");
        const failed = await Queue.getFailed(options.queue, options.connection);

        if (failed.length === 0) {
            console.log("\x1b[32m[StruxJS Queue]: No failed jobs found.\x1b[0m");
        } else {
            console.log(`\n\x1b[31m[StruxJS Queue]: ${failed.length} failed job(s):\x1b[0m\n`);
            for (const job of failed) {
                console.log(`  ID:       ${job.id}`);
                console.log(`  Class:    ${job.jobClass}`);
                console.log(`  Queue:    ${job.queue}`);
                console.log(`  Attempts: ${job.attempts}`);
                console.log(`  Failed:   ${job.failedAt ? new Date(job.failedAt).toISOString() : "unknown"}`);
                console.log(`  Error:    ${job.lastError || "unknown"}`);
                console.log("");
            }
        }
        process.exit(0);
    });

/**
 * Command: npx strux queue:retry <id>
 */
program
    .command("queue:retry <id>")
    .description("Retry a failed job by its ID (or 'all' to retry all failed jobs)")
    .option("-c, --connection <connection>", "Queue connection name")
    .action(async (id: string, options: { connection?: string }) => {
        try {
            const bootstrapDistPath = path.join(process.cwd(), "dist", "bootstrap.js");
            if (fs.existsSync(bootstrapDistPath)) {
                await import(pathToFileURL(bootstrapDistPath).href);
            }
        } catch { /* ignore */ }

        const { Queue } = await import("../core/queue/Queue.js");

        if (id === "all") {
            const failed = await Queue.getFailed(undefined, options.connection);
            if (failed.length === 0) {
                console.log("\x1b[32m[StruxJS Queue]: No failed jobs to retry.\x1b[0m");
            } else {
                let count = 0;
                for (const job of failed) {
                    const ok = await Queue.retry(job.id, options.connection);
                    if (ok) count++;
                }
                console.log(`\x1b[32m[StruxJS Queue]: Retried ${count} job(s).\x1b[0m`);
            }
        } else {
            const ok = await Queue.retry(id, options.connection);
            if (ok) {
                console.log(`\x1b[32m[StruxJS Queue]: Job ${id} has been re-queued.\x1b[0m`);
            } else {
                console.error(`\x1b[31m[StruxJS Queue]: Failed job with ID "${id}" not found.\x1b[0m`);
                process.exit(1);
            }
        }
        process.exit(0);
    });

/**
 * Command: npx strux queue:flush
 */
program
    .command("queue:flush")
    .description("Delete all failed jobs from the failed jobs list")
    .option("-c, --connection <connection>", "Queue connection name")
    .action(async (options: { connection?: string }) => {
        const { Queue } = await import("../core/queue/Queue.js");
        await Queue.flushFailed(options.connection);
        console.log("\x1b[32m[StruxJS Queue]: Failed jobs flushed successfully.\x1b[0m");
        process.exit(0);
    });

/**
 * Command: npx strux queue:table
 *
 * Generates two migration files:
 *   - create_jobs_table
 *   - create_failed_jobs_table
 *
 * Run after: npx strux migrate
 */
program
    .command("queue:table")
    .description("Create migration files for the database queue driver (jobs + failed_jobs tables)")
    .option("--jobs-table <name>", "Jobs table name", "jobs")
    .option("--failed-table <name>", "Failed jobs table name", "failed_jobs")
    .action(async (options: { jobsTable: string; failedTable: string }) => {
        const { Migrator } = await import("../core/database/migrations/Migrator.js");

        const jobsPath = Migrator.make(`create_${options.jobsTable}_table`);
        const failedPath = Migrator.make(`create_${options.failedTable}_table`);

        // Overwrite with queue-specific schema
        const jobsSchema = `import { Schema, Blueprint } from "struxjs";

export async function up(): Promise<void> {
    await Schema.create("${options.jobsTable}", (table: Blueprint) => {
        table.string("id", 36).primary();
        table.string("queue", 255).notNullable().defaultTo("default").index();
        table.text("payload").notNullable();
        table.integer("attempts").notNullable().defaultTo(0);
        table.bigInteger("available_at").notNullable().index();
        table.bigInteger("reserved_at").nullable().defaultTo(null);
        table.bigInteger("created_at").notNullable();
    });
}

export async function down(): Promise<void> {
    await Schema.dropIfExists("${options.jobsTable}");
}
`;

        const failedSchema = `import { Schema, Blueprint } from "struxjs";

export async function up(): Promise<void> {
    await Schema.create("${options.failedTable}", (table: Blueprint) => {
        table.string("id", 36).primary();
        table.string("queue", 255).notNullable().index();
        table.text("payload").notNullable();
        table.bigInteger("failed_at").notNullable().index();
    });
}

export async function down(): Promise<void> {
    await Schema.dropIfExists("${options.failedTable}");
}
`;

        fs.writeFileSync(jobsPath, jobsSchema, "utf-8");
        fs.writeFileSync(failedPath, failedSchema, "utf-8");

        const relJobs = path.relative(process.cwd(), jobsPath);
        const relFailed = path.relative(process.cwd(), failedPath);
        console.log(`\x1b[32m[StruxJS CLI]: Created migration: ${relJobs}\x1b[0m`);
        console.log(`\x1b[32m[StruxJS CLI]: Created migration: ${relFailed}\x1b[0m`);
        console.log(`\x1b[36m[StruxJS CLI]: Run \`npx strux migrate\` to apply.\x1b[0m`);
        process.exit(0);
    });

/* -------------------------------------------------------------------------- */
/*                          TASK SCHEDULER COMMANDS                           */
/* -------------------------------------------------------------------------- */

/**
 * Helper: load the app's schedule definition.
 * Supports two styles:
 *   1. routes/console.ts  — export default function (schedule: Schedule) => void
 *   2. app/Console/Kernel.ts — class extending ConsoleKernel (legacy)
 *
 * Search order: dist/ compiled JS first, then raw TS (works when running via tsx).
 */
async function loadKernel(): Promise<any> {
    const cwd = process.cwd();

    // Style 1: routes/console — preferred
    const routesCandidates = [
        path.join(cwd, "routes", "console.ts"),      // tsx: raw TS, always up-to-date
        path.join(cwd, "routes", "console.js"),
        path.join(cwd, "dist", "routes", "console.js"), // compiled fallback (npx strux)
    ];

    for (const p of routesCandidates) {
        if (fs.existsSync(p)) {
            const mod = await import(pathToFileURL(p).href);
            const fn = mod.default;
            if (typeof fn !== "function") {
                throw new Error(`[StruxJS CLI] ${p} must export a default function(schedule: Schedule).`);
            }

            const { Scheduler } = await import("../core/scheduling/Scheduler.js");
            const { Schedule } = await import("../core/scheduling/Schedule.js");

            const scheduler = new Scheduler();
            const builder = new Schedule(scheduler);
            fn(builder);

            return {
                tick: (date?: Date) => scheduler.tick(date),
                list: () => scheduler.list(),
            };
        }
    }

    throw new Error(
        "[StruxJS CLI] Schedule definition not found.\n" +
        "  Expected: routes/console.ts — export default function (schedule: Schedule) {}\n\n" +
        "  If using compiled output, run `npm run build` first so dist/routes/console.js exists."
    );
}

/**
 * Helper: boot app configs/DB without starting the HTTP server.
 * Loads a dedicated bootstrap-cli.ts/js if present, otherwise skips to avoid
 * starting the HTTP listener.
 */
async function bootApp(): Promise<void> {
    const cwd = process.cwd();

    // Automatically boot Database connection for CLI processes
    try {
        await bootDatabaseConfig();
    } catch { /* ignore if DB config missing */ }

    // Prefer a dedicated CLI bootstrap if present
    const candidates = [
        path.join(cwd, "bootstrap-cli.ts"),    // tsx: raw TS
        path.join(cwd, "bootstrap-cli.js"),
        path.join(cwd, "dist", "bootstrap-cli.js"),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { await import(pathToFileURL(p).href); } catch { /* ignore */ }
            return;
        }
    }
}

/**
 * Command: npx strux schedule:run
 * Run all due tasks once and exit (call this from a system cron every minute).
 */
program
    .command("schedule:run")
    .description("Run all due scheduled tasks once and exit")
    .option("--date <iso>", "Override the current date for testing (ISO 8601)")
    .action(async (options: { date?: string }) => {
        await bootApp();
        const kernel = await loadKernel();
        const date = options.date ? new Date(options.date) : new Date();

        console.log(`[StruxJS Scheduler] Running schedule:run at ${date.toISOString()}`);
        await kernel.tick(date);
        console.log("[StruxJS Scheduler] Done.");
        process.exit(0);
    });

/**
 * Command: npx strux schedule:work
 * Long-running daemon — ticks every minute at :00 seconds.
 * Use this instead of a system cron during development.
 */
program
    .command("schedule:work")
    .description("Start a scheduler daemon that ticks every minute (development)")
    .action(async () => {
        await bootApp();
        const kernel = await loadKernel();

        console.log("[StruxJS Scheduler] Daemon started — ticking every minute.");
        console.log("[StruxJS Scheduler] Press Ctrl+C to stop.\n");

        let stopped = false;
        process.on("SIGINT", () => { stopped = true; });
        process.on("SIGTERM", () => { stopped = true; });

        // Align to the start of the next minute
        const waitUntilNextMinute = (): Promise<void> => {
            const now = Date.now();
            const msUntil = 60_000 - (now % 60_000);
            return new Promise(resolve => setTimeout(resolve, msUntil));
        };

        // Run immediately on start so you can see it working right away
        await kernel.tick(new Date());

        while (!stopped) {
            await waitUntilNextMinute();
            if (stopped) break;

            const now = new Date();
            console.log(`[StruxJS Scheduler] Tick at ${now.toISOString()}`);
            await kernel.tick(now);
        }

        console.log("[StruxJS Scheduler] Daemon stopped.");
        process.exit(0);
    });

/**
 * Command: npx strux schedule:list
 * Display all registered tasks with their cron expression.
 */
program
    .command("schedule:list")
    .description("List all registered scheduled tasks")
    .action(async () => {
        await bootApp();
        const kernel = await loadKernel();
        const tasks: Array<{ description: string; expression: string }> = kernel.list();

        if (tasks.length === 0) {
            console.log("\x1b[33m[StruxJS Scheduler] No scheduled tasks registered.\x1b[0m");
        } else {
            console.log(`\n\x1b[36m[StruxJS Scheduler] ${tasks.length} scheduled task(s):\x1b[0m\n`);

            const exprWidth = Math.max(...tasks.map(t => t.expression.length), "Expression".length);
            const header = `  ${"Expression".padEnd(exprWidth)}   Description`;
            const divider = `  ${"-".repeat(exprWidth)}   ${"-".repeat(40)}`;

            console.log(header);
            console.log(divider);

            for (const task of tasks) {
                console.log(`  ${task.expression.padEnd(exprWidth)}   ${task.description}`);
            }
            console.log("");
        }

        process.exit(0);
    });

/**
 * Command: npx strux make:command <name>
 */
program
    .command("make:command <name>")
    .description("Create a new custom Console command")
    .action((name: string) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Console/Commands", name);

        const commandName = cleanClassName.endsWith("Command")
            ? cleanClassName
            : `${cleanClassName}Command`;

        const targetFile = path.join(targetDir, `${commandName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Command '${commandName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        // Generate a basic lowercase signature based on class name (e.g. TestCommand -> app:test)
        const signatureStr = commandName.replace(/Command$/, "").toLowerCase();

        const template = `import { Command } from "struxjs";
import { Command as CommanderCommand } from "commander";

export class ${commandName} extends Command {
    // The name and signature of the console command
    protected signature = "app:${signatureStr}";
    
    // The console command description
    protected description = "Description of ${commandName}";

    /**
     * Configure options for the command.
     */
    protected configure(command: CommanderCommand): void {
        // command.option('--force', 'Force execution');
    }

    // Execute the console command
    public async handle(...args: any[]): Promise<void> {
        console.log("Console command [${commandName}] executed successfully!");
    }
}
`;

        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Console Command created successfully at ${relPath}\x1b[0m`);
    });

/**
 * Command: npx strux make:mail <name>
 */
program
    .command("make:mail <name>")
    .description("Create a new Mailable class (e.g. WelcomeMail)")
    .option("--view <view>", "View template to use, e.g. emails.welcome")
    .option("--markdown", "Generate a plain markdown-style text email (no view)")
    .action((name: string, options: { view?: string; markdown?: boolean }) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Mail", name);

        const mailName = cleanClassName.endsWith("Mail")
            ? cleanClassName
            : `${cleanClassName}Mail`;

        const targetFile = path.join(targetDir, `${mailName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Mailable '${mailName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        // Determine view path: default to emails.<name_snake_case>
        const defaultView = `emails.${mailName
            .replace(/Mail$/, "")
            .replace(/([A-Z])/g, (m, c, i) => i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`)
            }`;

        const viewName = options.view || defaultView;

        let buildBody: string;

        if (options.markdown) {
            buildBody = `        return message
            .subject("${mailName.replace(/([A-Z])/g, (m, c, i) => i === 0 ? c : ` ${c}`)}")
            .text("Hello!\\n\\nThis is your email content.\\n\\nThanks.");`;
        } else {
            buildBody = `        return message
            .subject("${mailName.replace(/([A-Z])/g, (m, c, i) => i === 0 ? c : ` ${c}`)}")
            .view("${viewName}", {
                // Pass data to the view
            });`;
        }

        const template = `import { Mailable, MailMessage } from "struxjs";

export class ${mailName} extends Mailable {
    constructor(
        // public readonly user: any,
    ) {
        super();
    }

    public build(message: MailMessage): MailMessage {
${buildBody}
    }
}
`;

        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Mailable created at ${relPath}\x1b[0m`);

        if (!options.markdown) {
            const viewFilePath = path.join(
                process.cwd(), "resources", "views",
                viewName.replace(/\./g, path.sep) + ".strux"
            );

            if (!fs.existsSync(viewFilePath)) {
                fs.mkdirSync(path.dirname(viewFilePath), { recursive: true });

                const viewTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${mailName}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
        .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: #4f46e5; padding: 32px 40px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
        .body { padding: 40px; color: #374151; line-height: 1.6; }
        .footer { background: #f9fafb; padding: 20px 40px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
        .btn { display: inline-block; background: #4f46e5; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <h1>${mailName.replace(/Mail$/, "").replace(/([A-Z])/g, (m, c, i) => i === 0 ? c : ` ${c}`)}</h1>
        </div>
        <div class="body">
            <p>Hello,</p>
            <p><!-- Your email content here --></p>
            <a href="#" class="btn">Get Started</a>
        </div>
        <div class="footer">
            &copy; {{ new Date().getFullYear() }} Your Company. All rights reserved.
        </div>
    </div>
</body>
</html>
`;
                fs.writeFileSync(viewFilePath, viewTemplate);
                const relViewPath = path.relative(process.cwd(), viewFilePath);
                console.log(`\x1b[36m[StruxJS CLI]: View created at ${relViewPath}\x1b[0m`);
            }
        }

        console.log(`\x1b[36m[StruxJS CLI]: Usage:\x1b[0m`);
        console.log(`\x1b[90m  await Mail.to("user@example.com").send(new ${mailName}());\x1b[0m`);
        console.log(`\x1b[90m  await Mail.to("user@example.com").queue(new ${mailName}());\x1b[0m`);
    });

/**
 * Command: npx strux make:resource <name>
 */
program
    .command("make:resource <name>")
    .description("Create a new API Resource transformer class (e.g. UserResource)")
    .option("--collection", "Generate a dedicated ResourceCollection class as well")
    .action((name: string, options: { collection?: boolean }) => {
        const { targetDir, cleanClassName } = parseTargetLocation("Resources", name);

        const resourceName = cleanClassName.endsWith("Resource")
            ? cleanClassName
            : `${cleanClassName}Resource`;

        const targetFile = path.join(targetDir, `${resourceName}.ts`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Resource '${resourceName}' already exists.\x1b[0m`);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        // Derive model name from resource name (e.g. UserResource → User)
        const modelName = resourceName.replace(/Resource$/, "");

        const template = `import { Resource } from "struxjs";

export class ${resourceName} extends Resource {
    public transform(${modelName.toLowerCase()}: any) {
        return {
            id:         ${modelName.toLowerCase()}.id,
            // Add fields to expose:
            // name:    ${modelName.toLowerCase()}.name,
            // email:   ${modelName.toLowerCase()}.email,
            created_at: ${modelName.toLowerCase()}.created_at,
        };
    }
}
`;

        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Resource created at ${relPath}\x1b[0m`);

        // Optionally generate a dedicated collection class
        if (options.collection) {
            const collectionName = `${modelName}ResourceCollection`;
            const collectionFile = path.join(targetDir, `${collectionName}.ts`);

            const collectionTemplate = `import { ResourceCollection } from "struxjs";
import { ${resourceName} } from "./${resourceName}.js";

/**
 * ${collectionName}
 * Wraps an array or pagination result of ${modelName} into a formatted response.
 *
 * Usage:
 *   return new ${collectionName}(users);
 *   return new ${collectionName}(await ${modelName}.paginate(15, page));
 */
export class ${collectionName} extends ResourceCollection {
    constructor(data: any[] | { data: any[]; [key: string]: any }) {
        super(${resourceName}, data);
    }
}
`;
            fs.writeFileSync(collectionFile, collectionTemplate);
            const relColPath = path.relative(process.cwd(), collectionFile);
            console.log(`\x1b[32m[StruxJS CLI Success]: ResourceCollection created at ${relColPath}\x1b[0m`);
        }

        console.log(`\x1b[36m[StruxJS CLI]: Usage:\x1b[0m`);
        console.log(`\x1b[90m  // Single\x1b[0m`);
        console.log(`\x1b[90m  return new ${resourceName}(${modelName.toLowerCase()});\x1b[0m`);
        console.log(`\x1b[90m  return ${resourceName}.make(${modelName.toLowerCase()});\x1b[0m`);
        console.log(`\x1b[90m\x1b[0m`);
        console.log(`\x1b[90m  // Collection / Pagination\x1b[0m`);
        console.log(`\x1b[90m  return ${resourceName}.collection(${modelName.toLowerCase()}s);\x1b[0m`);
        console.log(`\x1b[90m  return ${resourceName}.collection(await ${modelName}.paginate(15, page));\x1b[0m`);
    });

/**
 * Command: npx strux make:pagination <name>
 */
program
    .command("make:pagination <name>")
    .description("Create a custom pagination view template (e.g. tailwind, simple, custom)")
    .action((name: string) => {
        const paginationDir = path.join(process.cwd(), "resources", "views", "pagination");
        fs.mkdirSync(paginationDir, { recursive: true });

        const cleanName = name.toLowerCase().replace(/\.strux$/, "");
        const targetFile = path.join(paginationDir, `${cleanName}.strux`);

        if (fs.existsSync(targetFile)) {
            console.error(`\x1b[31m[StruxJS CLI Error]: Pagination view '${cleanName}.strux' already exists.\x1b[0m`);
            return;
        }

        // Determine template type based on name
        let template: string;

        if (cleanName.includes("simple") || cleanName.includes("minimal")) {
            // Simple prev/next only template
            template = `{{-- Simple Pagination Template (Previous/Next only) --}}

<div class="flex justify-between items-center py-4">
    <div>
        @if(paginator.previousPageUrl)
            <a href="{{ paginator.previousPageUrl }}" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Previous
            </a>
        @else
            <span class="px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
                Previous
            </span>
        @endif
    </div>

    <div class="text-sm text-gray-700">
        Page {{ paginator.currentPage }} of {{ paginator.lastPage }}
    </div>

    <div>
        @if(paginator.nextPageUrl)
            <a href="{{ paginator.nextPageUrl }}" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Next
            </a>
        @else
            <span class="px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
                Next
            </span>
        @endif
    </div>
</div>
`;
        } else if (cleanName.includes("bootstrap") || cleanName.includes("bs")) {
            // Bootstrap style template
            template = `{{-- Bootstrap 5 Pagination Template --}}

<nav aria-label="Page navigation">
    <ul class="pagination justify-content-center">
        {{-- Previous Button --}}
        @if(paginator.previousPageUrl)
            <li class="page-item">
                <a class="page-link" href="{{ paginator.previousPageUrl }}">Previous</a>
            </li>
        @else
            <li class="page-item disabled">
                <span class="page-link">Previous</span>
            </li>
        @endif

        {{-- Page Info --}}
        <li class="page-item active">
            <span class="page-link">
                {{ paginator.currentPage }} / {{ paginator.lastPage }}
            </span>
        </li>

        {{-- Next Button --}}
        @if(paginator.nextPageUrl)
            <li class="page-item">
                <a class="page-link" href="{{ paginator.nextPageUrl }}">Next</a>
            </li>
        @else
            <li class="page-item disabled">
                <span class="page-link">Next</span>
            </li>
        @endif
    </ul>

    {{-- Pagination Info --}}
    <p class="text-center text-muted small">
        Showing {{ paginator.from }} to {{ paginator.to }} of {{ paginator.total }} results
    </p>
</nav>
`;
        } else {
            // Full featured Tailwind template (default)
            template = `{{-- Custom Pagination Template --}}
{{-- Available data: paginator object with full pagination info --}}

<div class="pagination-wrapper">
    <nav class="pagination-nav" aria-label="Pagination">
        {{-- Pagination Info --}}
        <div class="pagination-info mb-3">
            <p class="text-sm text-gray-700">
                Showing <span class="font-medium">{{ paginator.from }}</span> 
                to <span class="font-medium">{{ paginator.to }}</span> 
                of <span class="font-medium">{{ paginator.total }}</span> results
            </p>
        </div>

        {{-- Pagination Links --}}
        <div class="pagination-links flex items-center justify-center space-x-2">
            {{-- Previous Button --}}
            @if(paginator.onFirstPage)
                <span class="pagination-disabled px-4 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed">
                    ← Previous
                </span>
            @else
                <a href="{{ paginator.previousPageUrl }}" 
                   class="pagination-link px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
                    ← Previous
                </a>
            @endif

            {{-- Current Page Indicator --}}
            <span class="pagination-current px-4 py-2 bg-blue-600 text-white font-bold rounded">
                Page {{ paginator.currentPage }} / {{ paginator.lastPage }}
            </span>

            {{-- Next Button --}}
            @if(paginator.hasMorePages)
                <a href="{{ paginator.nextPageUrl }}" 
                   class="pagination-link px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
                    Next →
                </a>
            @else
                <span class="pagination-disabled px-4 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed">
                    Next →
                </span>
            @endif
        </div>
    </nav>
</div>

{{-- 
Available paginator properties:
- paginator.currentPage      : Current page number
- paginator.lastPage          : Last page number
- paginator.perPage           : Items per page
- paginator.total             : Total records
- paginator.from              : First item number on current page
- paginator.to                : Last item number on current page
- paginator.hasMorePages      : Boolean - true if more pages exist
- paginator.onFirstPage       : Boolean - true if on first page
- paginator.previousPageUrl   : URL for previous page (null if none)
- paginator.nextPageUrl       : URL for next page (null if none)
- paginator.firstPageUrl      : URL for first page
- paginator.lastPageUrl       : URL for last page
--}}
`;
        }

        fs.writeFileSync(targetFile, template);
        const relPath = path.relative(process.cwd(), targetFile);
        console.log(`\x1b[32m[StruxJS CLI Success]: Pagination view created at ${relPath}\x1b[0m`);
        console.log(`\x1b[36m[StruxJS CLI]: Usage in controller:\x1b[0m`);
        console.log(`\x1b[90m  const users = await User.paginate(15);\x1b[0m`);
        console.log(`\x1b[90m  const paginationHtml = users.links('pagination.${cleanName}');\x1b[0m`);
        console.log(`\x1b[90m  return view('users', { users, paginationHtml });\x1b[0m`);
    });

/**
 * Auto-load custom user commands from app/Console/Commands
 */
async function loadCustomCommands(prog: any) {
    const commandsDir = path.join(process.cwd(), "app", "Console", "Commands");
    if (!fs.existsSync(commandsDir)) return;

    let BaseCommand: any;
    try {
        const mod = await import("../core/console/Command.js");
        BaseCommand = mod.Command;
    } catch { return; }

    function walk(dir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach(function (file) {
            const fileRef = path.join(dir, file);
            const stat = fs.statSync(fileRef);
            if (stat && stat.isDirectory()) {
                results = results.concat(walk(fileRef));
            } else if (file.endsWith(".ts") || file.endsWith(".js")) {
                results.push(fileRef);
            }
        });
        return results;
    }

    const files = walk(commandsDir);
    for (const filePath of files) {
        const fileUrl = pathToFileURL(filePath).href;
        try {
            const module = await import(fileUrl);
            for (const exportedItem of Object.values(module)) {
                if (
                    typeof exportedItem === "function" &&
                    exportedItem.prototype &&
                    typeof exportedItem.prototype.register === "function" &&
                    typeof exportedItem.prototype.handle === "function"
                ) {
                    const cmdInstance = new (exportedItem as any)();
                    cmdInstance.register(prog);
                }
            }
        } catch (e) {
            // Ignore syntax errors in unfinished commands during scanning
        }
    }
}

// Execute the CLI
await loadCustomCommands(program);
await program.parseAsync(process.argv);
