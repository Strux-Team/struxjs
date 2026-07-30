import { Knex } from "knex";
import { BaseModel } from "./BaseModel.js";
import { MongoConnection } from "./MongoConnection.js";
import { collect, Collection } from "./EloquentBuilder.js";

export class DB {
    /**
     * Execute a callback inside an automatic database transaction.
     * Auto-commits on success, auto-rolls back on exception.
     */
    public static async transaction<T>(callback: (trx: Knex.Transaction | any) => Promise<T>): Promise<T> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const client = MongoConnection.getClient();
            const session = client.startSession();
            try {
                session.startTransaction();
                const result = await callback(session);
                await session.commitTransaction();
                return result;
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                await session.endSession();
            }
        }

        const db = BaseModel.connection();
        return await db.transaction(async (trx) => {
            return await callback(trx);
        });
    }

    /**
     * Begin a manual database transaction
     */
    public static async beginTransaction(): Promise<Knex.Transaction | any> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            const client = MongoConnection.getClient();
            const session = client.startSession();
            session.startTransaction();
            return session;
        }

        const db = BaseModel.connection();
        return await db.transaction();
    }

    /**
     * Commit a manual transaction
     */
    public static async commit(trx: any): Promise<void> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            await trx.commitTransaction();
            await trx.endSession();
            return;
        }

        if (trx && typeof trx.commit === "function") {
            await trx.commit();
        }
    }

    /**
     * Rollback a manual transaction
     */
    public static async rollback(trx: any): Promise<void> {
        const driver = BaseModel.getActiveDriver();

        if (driver === "mongodb") {
            await trx.abortTransaction();
            await trx.endSession();
            return;
        }

        if (trx && typeof trx.rollback === "function") {
            await trx.rollback();
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                           RAW QUERY METHODS (Laravel Style)                */
    /* -------------------------------------------------------------------------- */

    /**
     * Execute a raw SELECT query with bindings: DB.select("SELECT * FROM users WHERE status = ?", [1])
     * Returns a Collection wrapped result set for easy post-processing.
     */
    public static async select(sql: string, bindings: any[] = [], trx?: any): Promise<Collection<any>> {
        const db = BaseModel.connection();
        let query = db.raw(sql, bindings);
        if (trx) query = query.transacting(trx);

        const res = await query;
        const rows = Array.isArray(res[0]) ? res[0] : res;
        return collect(Array.isArray(rows) ? rows : [rows]);
    }

    /**
     * Execute a raw INSERT query with bindings: DB.insert("INSERT INTO users (name, email) VALUES (?, ?)", ["Alex", "alex@example.com"])
     */
    public static async insert(sql: string, bindings: any[] = [], trx?: any): Promise<any> {
        const db = BaseModel.connection();
        let query = db.raw(sql, bindings);
        if (trx) query = query.transacting(trx);

        const res = await query;
        return res[0];
    }

    /**
     * Execute a raw UPDATE query with bindings: DB.update("UPDATE users SET status = ? WHERE id = ?", [1, 5])
     */
    public static async update(sql: string, bindings: any[] = [], trx?: any): Promise<number> {
        const db = BaseModel.connection();
        let query = db.raw(sql, bindings);
        if (trx) query = query.transacting(trx);

        const res = await query;
        if (typeof res === "number") return res;
        if (typeof res?.changes === "number") return res.changes;
        if (typeof res?.affectedRows === "number") return res.affectedRows;
        if (res && res[0]) {
            return res[0].affectedRows ?? res[0].changes ?? (typeof res[0] === "number" ? res[0] : 1);
        }
        return 1;
    }

    /**
     * Execute a raw DELETE query with bindings: DB.delete("DELETE FROM users WHERE id = ?", [5])
     */
    public static async delete(sql: string, bindings: any[] = [], trx?: any): Promise<number> {
        const db = BaseModel.connection();
        let query = db.raw(sql, bindings);
        if (trx) query = query.transacting(trx);

        const res = await query;
        if (typeof res === "number") return res;
        if (typeof res?.changes === "number") return res.changes;
        if (typeof res?.affectedRows === "number") return res.affectedRows;
        if (res && res[0]) {
            return res[0].affectedRows ?? res[0].changes ?? (typeof res[0] === "number" ? res[0] : 1);
        }
        return 1;
    }

    /**
     * Execute an arbitrary raw SQL statement: DB.statement("SET FOREIGN_KEY_CHECKS = 0")
     */
    public static async statement(sql: string, bindings: any[] = [], trx?: any): Promise<any> {
        const db = BaseModel.connection();
        let query = db.raw(sql, bindings);
        if (trx) query = query.transacting(trx);

        return await query;
    }

    /**
     * Create a raw SQL expression to use inside query builder: DB.raw("CURRENT_TIMESTAMP")
     */
    public static raw(sql: string, bindings: any[] = []): Knex.Raw {
        const db = BaseModel.connection();
        return db.raw(sql, bindings);
    }

    /**
     * Get a query builder instance for a specific table: DB.table('users')
     */
    public static table(tableName: string): Knex.QueryBuilder {
        const db = BaseModel.connection();
        return db(tableName);
    }
}
