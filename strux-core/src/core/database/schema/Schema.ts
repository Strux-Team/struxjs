import { BaseModel } from "../BaseModel.js";
import { MongoConnection } from "../MongoConnection.js";
import { TableBuilder } from "./TableBuilder.js";

export class Schema {
    /**
     * Create a new database table or collection
     */
    public static async create(tableName: string, callback: (table: TableBuilder) => void): Promise<void> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.createCollection(tableName);
            return;
        }

        const db = BaseModel.connection();
        await db.schema.createTable(tableName, (knexTable) => {
            const blueprint = new TableBuilder(knexTable);
            callback(blueprint);
        });
    }

    /**
     * Modify an existing database table schema
     */
    public static async table(tableName: string, callback: (table: TableBuilder) => void): Promise<void> {
        const driver = BaseModel.getActiveDriver();
        if (driver === "mongodb") return;

        const db = BaseModel.connection();
        await db.schema.table(tableName, (knexTable) => {
            const blueprint = new TableBuilder(knexTable);
            callback(blueprint);
        });
    }

    /**
     * Drop table if exists
     */
    public static async dropIfExists(tableName: string): Promise<void> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            const collections = await db.listCollections({ name: tableName }).toArray();
            if (collections.length > 0) {
                await db.collection(tableName).drop();
            }
            return;
        }

        const db = BaseModel.connection();
        await db.schema.dropTableIfExists(tableName);
    }

    /**
     * Alias for dropIfExists (Laravel compatibility)
     */
    public static async dropTableIfExists(tableName: string): Promise<void> {
        return this.dropIfExists(tableName);
    }

    /**
     * Drop table
     */
    public static async drop(tableName: string): Promise<void> {
        return this.dropIfExists(tableName);
    }

    /**
     * Check if table exists
     */
    public static async hasTable(tableName: string): Promise<boolean> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            const collections = await db.listCollections({ name: tableName }).toArray();
            return collections.length > 0;
        }

        const db = BaseModel.connection();
        return await db.schema.hasTable(tableName);
    }

    /**
     * Check if column exists in table
     */
    public static async hasColumn(tableName: string, columnName: string): Promise<boolean> {
        const driver = BaseModel.getActiveDriver();
        if (driver === "mongodb") return true;

        const db = BaseModel.connection();
        return await db.schema.hasColumn(tableName, columnName);
    }

    /**
     * Rename table
     */
    public static async rename(fromTable: string, toTable: string): Promise<void> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(fromTable).rename(toTable);
            return;
        }

        const db = BaseModel.connection();
        await db.schema.renameTable(fromTable, toTable);
    }

    /**
     * Alias for rename table
     */
    public static async renameTable(fromTable: string, toTable: string): Promise<void> {
        return this.rename(fromTable, toTable);
    }
}
