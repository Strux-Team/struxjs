import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { BaseModel } from "../BaseModel.js";
import { Schema } from "../schema/Schema.js";
import { Blueprint } from "../schema/Blueprint.js";

export interface MigrationFile {
    name: string;
    filePath: string;
    up: () => Promise<void>;
    down: () => Promise<void>;
}

export class Migrator {
    private migrationsDir: string;

    constructor(customDir?: string) {
        this.migrationsDir = customDir || path.join(process.cwd(), "database", "migrations");
    }

    /**
     * Ensure database connection and migrations tracking table exist
     */
    private async prepareTrackingTable(): Promise<void> {
        const hasTable = await Schema.hasTable("migrations");
        if (!hasTable) {
            await Schema.create("migrations", (table: Blueprint) => {
                table.id();
                table.string("migration");
                table.integer("batch");
            });
        }
    }

    /**
     * Get all migration files from database/migrations/ sorted by timestamp prefix
     */
    private async getMigrationFiles(): Promise<MigrationFile[]> {
        if (!fs.existsSync(this.migrationsDir)) {
            fs.mkdirSync(this.migrationsDir, { recursive: true });
            return [];
        }

        const files = fs.readdirSync(this.migrationsDir)
            .filter(f => f.endsWith(".ts") || f.endsWith(".js"))
            .sort();

        const result: MigrationFile[] = [];

        for (const file of files) {
            const filePath = path.join(this.migrationsDir, file);
            const module = await import(pathToFileURL(filePath).href);
            const migrationObj = module.default || module;

            if (typeof migrationObj.up === "function" && typeof migrationObj.down === "function") {
                result.push({
                    name: file.replace(/\.(ts|js)$/, ""),
                    filePath,
                    up: migrationObj.up,
                    down: migrationObj.down
                });
            }
        }

        return result;
    }

    /**
     * Run all pending migrations in a new batch
     */
    public async run(): Promise<void> {
        await this.prepareTrackingTable();
        const files = await this.getMigrationFiles();

        const ranMigrations = await BaseModel.connection()("migrations").select("migration");
        const ranNames = ranMigrations.map((r: any) => r.migration);

        const pending = files.filter(f => !ranNames.includes(f.name));

        if (pending.length === 0) {
            console.log("\x1b[32mNothing to migrate.\x1b[0m");
            return;
        }

        const maxBatchRes = await BaseModel.connection()("migrations").max("batch as maxBatch").first();
        const nextBatch = ((maxBatchRes as any)?.maxBatch || 0) + 1;

        console.log(`\n\x1b[34mRunning migrations (Batch ${nextBatch})...\x1b[0m`);

        for (const migration of pending) {
            console.log(`  Migrating: \x1b[36m${migration.name}\x1b[0m`);
            const start = Date.now();
            await migration.up();
            const time = Date.now() - start;

            await BaseModel.connection()("migrations").insert({
                migration: migration.name,
                batch: nextBatch
            });

            console.log(`  \x1b[32mMigrated:\x1b[0m  ${migration.name} (${time}ms)`);
        }

        console.log(`\x1b[32mSUCCESS: Batch ${nextBatch} migrated successfully.\x1b[0m\n`);
    }

    /**
     * Rollback the last N batches of migrations (default: 1)
     */
    public async rollback(steps: number = 1): Promise<void> {
        await this.prepareTrackingTable();

        const maxBatchRes = await BaseModel.connection()("migrations").max("batch as maxBatch").first();
        const lastBatch = (maxBatchRes as any)?.maxBatch;

        if (!lastBatch) {
            console.log("\x1b[33mNothing to rollback.\x1b[0m");
            return;
        }

        const firstBatchToRollback = Math.max(1, lastBatch - steps + 1);
        const files = await this.getMigrationFiles();
        const fileMap = new Map(files.map(f => [f.name, f]));

        for (let batch = lastBatch; batch >= firstBatchToRollback; batch--) {
            const batchRecords = await BaseModel.connection()("migrations")
                .where("batch", batch)
                .orderBy("id", "desc");

            if (batchRecords.length === 0) continue;

            console.log(`\n\x1b[33mRolling back migrations (Batch ${batch})...\x1b[0m`);

            for (const record of batchRecords) {
                const migration = fileMap.get(record.migration);
                if (migration) {
                    console.log(`  Rolling back: \x1b[36m${migration.name}\x1b[0m`);
                    const start = Date.now();
                    await migration.down();
                    const time = Date.now() - start;

                    await BaseModel.connection()("migrations").where("id", record.id).delete();
                    console.log(`  \x1b[32mRolled back:\x1b[0m ${migration.name} (${time}ms)`);
                }
            }

            console.log(`\x1b[32mSUCCESS: Batch ${batch} rolled back successfully.\x1b[0m`);
        }

        console.log();
    }

    /**
     * Reset all migrations
     */
    public async reset(): Promise<void> {
        await this.prepareTrackingTable();
        const records = await BaseModel.connection()("migrations").orderBy("id", "desc");

        if (records.length === 0) {
            console.log("\x1b[33mNothing to reset.\x1b[0m");
            return;
        }

        const files = await this.getMigrationFiles();
        const fileMap = new Map(files.map(f => [f.name, f]));

        console.log(`\n\x1b[33mResetting all migrations...\x1b[0m`);

        for (const record of records) {
            const migration = fileMap.get(record.migration);
            if (migration) {
                console.log(`  Rolling back: \x1b[36m${migration.name}\x1b[0m`);
                await migration.down();
                await BaseModel.connection()("migrations").where("id", record.id).delete();
                console.log(`  \x1b[32mRolled back:\x1b[0m ${migration.name}`);
            }
        }

        console.log(`\x1b[32mSUCCESS: All migrations reset successfully.\x1b[0m\n`);
    }

    /**
     * Refresh: Reset all migrations and re-run
     */
    public async refresh(): Promise<void> {
        await this.reset();
        await this.run();
    }

    /**
     * Fresh: Drop all tables and re-run all migrations from scratch
     */
    public async fresh(): Promise<void> {
        console.log(`\n\x1b[31mDropping all tables...\x1b[0m`);
        const db = BaseModel.connection();
        
        // Disable foreign keys temporarily
        await db.raw("SET FOREIGN_KEY_CHECKS = 0;").catch(() => {});
        
        const tables = await db.raw("SHOW TABLES").catch(() => []);
        if (Array.isArray(tables) && tables.length > 0) {
            for (const row of tables[0] || []) {
                const tableName = Object.values(row)[0] as string;
                if (tableName) {
                    await Schema.dropIfExists(tableName);
                }
            }
        }

        await db.raw("SET FOREIGN_KEY_CHECKS = 1;").catch(() => {});
        console.log(`\x1b[32mAll tables dropped successfully.\x1b[0m`);

        await this.run();
    }

    /**
     * Display current status of all migrations
     */
    public async status(): Promise<void> {
        await this.prepareTrackingTable();
        const files = await this.getMigrationFiles();
        const ranRecords = await BaseModel.connection()("migrations").select();
        const ranMap = new Map(ranRecords.map((r: any) => [r.migration, r.batch]));

        console.log(`\n+------+------------------------------------------+-------+`);
        console.log(`| Ran? | Migration                                | Batch |`);
        console.log(`+------+------------------------------------------+-------+`);

        files.forEach(f => {
            const batch = ranMap.get(f.name);
            const ranText = batch ? "\x1b[32m Yes \x1b[0m" : "\x1b[31m No  \x1b[0m";
            const batchText = batch ? String(batch).padStart(5) : "     ";
            const nameText = f.name.padEnd(40);
            console.log(`| ${ranText} | ${nameText} | ${batchText} |`);
        });

        console.log(`+------+------------------------------------------+-------+\n`);
    }

    /**
     * Generate a new timestamped migration file (e.g. 2026_07_27_102146_create_users_table.ts)
     */
    public static make(name: string, customDir?: string): string {
        const migrationsDir = customDir || path.join(process.cwd(), "database", "migrations");
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const now = new Date();
        const timestamp = now.toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
        const fileName = `${timestamp}_${name.toLowerCase().replace(/\s+/g, "_")}.ts`;
        const filePath = path.join(migrationsDir, fileName);

        const isCreateTable = name.startsWith("create_");
        const matchTable = name.match(/create_(.*?)_table/) || name.match(/_to_(.*?)_table/) || name.match(/_in_(.*?)_table/);
        const tableName = matchTable ? (matchTable[1] || matchTable[2] || matchTable[3]) : "table_name";

        const content = isCreateTable ? `import { Schema, Blueprint } from "struxjs";

export default {
    async up() {
        await Schema.create("${tableName}", (table: Blueprint) => {
            table.id();
            table.timestamps();
        });
    },

    async down() {
        await Schema.dropIfExists("${tableName}");
    }
};
` : `import { Schema, Blueprint } from "struxjs";

export default {
    async up() {
        await Schema.table("${tableName}", (table: Blueprint) => {
            // Add columns here
        });
    },

    async down() {
        await Schema.table("${tableName}", (table: Blueprint) => {
            // Rollback changes here
        });
    }
};
`;

        fs.writeFileSync(filePath, content, "utf8");
        return filePath;
    }
}
