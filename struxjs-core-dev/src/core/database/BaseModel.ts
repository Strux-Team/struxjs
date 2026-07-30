import knex, { Knex } from "knex";
import collect, { Collection } from "collect.js";
import { EloquentBuilder, GlobalScopeCallback, PaginationResult } from "./EloquentBuilder.js";
import { HasOne } from "./relations/HasOne.js";
import { HasMany } from "./relations/HasMany.js";
import { BelongsTo } from "./relations/BelongsTo.js";
import { BelongsToMany } from "./relations/BelongsToMany.js";
import { Relation } from "./relations/Relation.js";
import { MongoConnection } from "./MongoConnection.js";
import { config, env } from "../config/Config.js";
import { dd, dump } from "../http/HttpContext.js";

// Global database connection instances
let dbConnection: Knex | null = null;
let activeDriver: "sql" | "mongodb" = "sql";

// Per-class global scope registry — keyed by model class name, then scope name
const globalScopeRegistry: Map<string, Map<string, GlobalScopeCallback<any>>> = new Map();

// Tracks which model classes have already had their boot() called
const bootedModels: Set<string> = new Set();

// Known model configuration metadata properties that must not be treated as DB columns
const MODEL_CONFIG_KEYS = new Set([
    "table", "primaryKey", "fillable", "guarded", "hidden", "appends",
    "timestamps", "createdColumn", "updatedColumn", "softDelete",
    "deletedAtColumn", "casts", "attributes", "relations", "with",
    "connectionName", "keyType", "incrementing", "broadcastEvents"
]);

const BASE_MODEL_RESERVED_KEYS = new Set([
    "save", "delete", "destroy", "forceDelete", "restore", "refresh", "update",
    "toArray", "toJSON", "fill", "castAttribute", "prepareAttributesForSave",
    "updateTimestampsForSave", "hasOne", "hasMany", "belongsTo", "belongsToMany",
    "onCreating", "onCreated", "onUpdating", "onUpdated", "onSaving", "onSaved",
    "onDeleting", "onDeleted", "trashed", "dump", "dd", "broadcastOn", "broadcastAs",
    "broadcastWith", "dispatchModelBroadcast"
]);

export abstract class BaseModel {
    // Database table name (Defaults to pluralized class name if not set)
    protected table!: string;

    // Primary key column name
    protected primaryKey: string = "id";

    // Automatic timestamps flag (Set to false to disable created_at & updated_at)
    public timestamps: boolean = true;

    // Custom timestamp column names (Set to custom string or null to disable individual column)
    public createdColumn: string | null = "created_at";
    public updatedColumn: string | null = "updated_at";

    // Static timestamp constants for Laravel compatibility (e.g. static CREATED_AT = 'created_time')
    public static CREATED_AT: string | null = "created_at";
    public static UPDATED_AT: string | null = "updated_at";

    /**
     * Enable soft deletes — set to true to activate.
     * When true, delete() sets deleted_at instead of removing the row.
     * All queries automatically exclude soft-deleted records via a global scope.
     * Override deletedAtColumn to use a custom column name.
     *
     * class Post extends BaseModel {
     *     public softDelete = true;
     *     // public deletedAtColumn = 'removed_at'; // optional custom column
     * }
     */
    public softDelete: boolean = false;
    public deletedAtColumn: string = "deleted_at";

    /**
     * Enable automatic CRUD WebSocket broadcasting for this model.
     * Set to true to broadcast all actions ('created', 'updated', 'deleted'),
     * or pass an array of specific actions.
     */
    protected broadcastEvents: boolean | Array<"created" | "updated" | "deleted"> = false;

    /**
     * Get the channels that the model event should broadcast on.
     */
    public broadcastOn(action: "created" | "updated" | "deleted"): string | string[] {
        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;
        if (action === "created") {
            return [tableName];
        }
        const id = this.attributes.id || this.attributes._id || this.attributes[this.primaryKey];
        return id ? [tableName, `${tableName}.${id}`] : [tableName];
    }

    /**
     * Get the event name to broadcast as.
     */
    public broadcastAs(action: "created" | "updated" | "deleted"): string {
        const rawName = this.constructor.name;
        const modelName = (rawName && rawName !== "Object") 
            ? rawName 
            : (Object.getPrototypeOf(this)?.constructor?.name || "Model");
        const capitalizedAction = action.charAt(0).toUpperCase() + action.slice(1);
        return `${modelName}${capitalizedAction}`;
    }

    /**
     * Get the payload data to broadcast with.
     */
    public broadcastWith(action: "created" | "updated" | "deleted"): Record<string, any> {
        return {
            action,
            model: this.toArray()
        };
    }

    /**
     * Dispatch model CRUD event over WebSocket/Broadcast channels
     */
    public async dispatchModelBroadcast(action: "created" | "updated" | "deleted"): Promise<void> {
        if (!this.broadcastEvents) return;

        const isEnabled = this.broadcastEvents === true ||
            (Array.isArray(this.broadcastEvents) && (this.broadcastEvents as any).includes(action));

        if (!isEnabled) return;

        try {
            const { Broadcast } = await import("../broadcasting/Broadcast.js");
            const channels = this.broadcastOn(action);
            const eventName = this.broadcastAs(action);
            const payload = this.broadcastWith(action);

            await Broadcast.to(channels).emit(eventName, payload);
        } catch {
            // Ignore broadcasting errors if broadcast engine is unconfigured
        }
    }

    // Primary Key accessor property type declaration for TypeScript
    public id?: any;

    // Allow dynamic attribute & relationship property access in TypeScript (e.g. user.name, user.posts)
    [key: string]: any;

    // Attribute Casting definition (e.g. casts = { is_active: 'boolean', settings: 'json' })
    public casts: Record<string, "boolean" | "integer" | "float" | "json" | "array" | "object" | "date" | "string"> = {};

    /**
     * The attributes that are mass assignable.
     * When set, only the listed keys are accepted by fill() and create().
     * An empty array (default) allows all attributes through.
     *
     * protected fillable = ["name", "email", "status"];
     */
    protected fillable: string[] = [];

    // Raw attributes container storing database columns data
    public attributes: Record<string, any> = {};

    // Storage for loaded relation instances (e.g. user.relations['posts'])
    public relations: Record<string, any> = {};

    constructor(attributes: Record<string, any> = {}) {
        this.attributes = { ...attributes };

        // Proxy allows dynamic property access:
        // 1. Checks loaded relationship models (e.g. user.posts)
        // 2. Checks explicit class methods/fields
        // 3. Casts & returns column attributes (e.g. user.is_active, user.settings)
        return new Proxy(this, {
            get(target: any, prop: string | symbol) {
                if (typeof prop === "string") {
                    // 1. Check loaded relationship cache
                    if (prop in target.relations) {
                        return target.relations[prop];
                    }

                    // 2. Check explicit class methods/fields
                    if (prop in target) {
                        const val = target[prop];
                        if (typeof val === "function" && !BASE_MODEL_RESERVED_KEYS.has(prop)) {
                            try {
                                const rel = val.call(target);
                                if (rel && rel instanceof Relation) {
                                    // Create callable thenable function proxy
                                    const fn = function (...args: any[]) {
                                        return rel;
                                    };
                                    (fn as any).then = function (onfulfilled?: any, onrejected?: any) {
                                        return rel.get().then((results: any) => {
                                            target.relations[prop] = results;
                                            return results;
                                        }).then(onfulfilled, onrejected);
                                    };
                                    return new Proxy(fn, {
                                        get(fnTarget: any, fnProp: string | symbol) {
                                            if (fnProp === "then") return fnTarget.then;
                                            if (fnProp in rel || typeof (rel as any)[fnProp] === "function") {
                                                const res = (rel as any)[fnProp];
                                                return typeof res === "function" ? res.bind(rel) : res;
                                            }
                                            return fnTarget[fnProp];
                                        }
                                    });
                                }
                            } catch {
                                // Regular method — return unchanged
                            }
                        }
                        return val;
                    }

                    // 3. Id mapping for MongoDB _id -> id
                    if (prop === "id" && !target.attributes.id && target.attributes._id) {
                        return String(target.attributes._id);
                    }

                    // 4. Attribute casting
                    const rawVal = target.attributes[prop];
                    if (rawVal !== undefined && rawVal !== null && target.casts && prop in target.casts) {
                        return target.castAttribute(prop, rawVal);
                    }
                    return rawVal;
                }
                return (target as any)[prop];
            },
            set(target: any, prop: string, value: any) {
                if (prop in target || MODEL_CONFIG_KEYS.has(prop)) {
                    target[prop] = value;
                } else {
                    target.attributes[prop] = value;
                }
                return true;
            }
        });
    }

    /**
     * Cast raw attribute value based on cast rules
     */
    public castAttribute(key: string, value: any): any {
        if (value === null || value === undefined) return value;
        const castType = this.casts[key];
        if (!castType) return value;

        switch (castType) {
            case "boolean":
                return value === true || value === 1 || value === "1" || value === "true";
            case "integer":
                return parseInt(value, 10);
            case "float":
                return parseFloat(value);
            case "json":
            case "array":
            case "object":
                if (typeof value === "string") {
                    try { return JSON.parse(value); } catch { return value; }
                }
                return value;
            case "date":
                return value instanceof Date ? value : new Date(value);
            case "string":
                return String(value);
            default:
                return value;
        }
    }

    /**
     * Prepare attributes container for insert/update (e.g. stringify JSON columns)
     */
    public prepareAttributesForSave(): Record<string, any> {
        const data = { ...this.attributes };
        for (const key of MODEL_CONFIG_KEYS) {
            delete data[key];
        }
        if (this.casts) {
            Object.keys(this.casts).forEach(key => {
                const castType = this.casts[key];
                if ((castType === "json" || castType === "array" || castType === "object") && typeof data[key] === "object" && data[key] !== null) {
                    data[key] = JSON.stringify(data[key]);
                }
            });
        }
        return data;
    }

    public setRelation(name: string, value: any): this {
        this.relations[name] = value;
        return this;
    }

    public getRelation(name: string): any {
        return this.relations[name];
    }

    /**
     * Helper to set timestamps on insert/update according to model configuration
     */
    protected updateTimestampsForSave(isInsert: boolean): void {
        if (!this.timestamps) return;

        const now = new Date();
        const createdCol = this.createdColumn === null ? null : (this.createdColumn ?? (this.constructor as any).CREATED_AT);
        const updatedCol = this.updatedColumn === null ? null : (this.updatedColumn ?? (this.constructor as any).UPDATED_AT);

        if (isInsert && createdCol && !this.attributes[createdCol]) {
            this.attributes[createdCol] = now;
        }

        if (updatedCol) {
            this.attributes[updatedCol] = now;
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                         RELATIONSHIP HELPER DEFINITIONS                    */
    /* -------------------------------------------------------------------------- */

    public hasOne(related: new (attrs?: Record<string, any>) => BaseModel, foreignKey?: string, localKey?: string): HasOne {
        return new HasOne(this, related, foreignKey, localKey);
    }

    public hasMany(related: new (attrs?: Record<string, any>) => BaseModel, foreignKey?: string, localKey?: string): HasMany {
        return new HasMany(this, related, foreignKey, localKey);
    }

    public belongsTo(related: new (attrs?: Record<string, any>) => BaseModel, foreignKey?: string, ownerKey?: string): BelongsTo {
        return new BelongsTo(this, related, foreignKey, ownerKey);
    }

    public belongsToMany(
        related: new (attrs?: Record<string, any>) => BaseModel,
        pivotTable?: string,
        foreignPivotKey?: string,
        relatedPivotKey?: string,
        parentKey?: string,
        relatedKey?: string
    ): BelongsToMany {
        return new BelongsToMany(this, related, pivotTable, foreignPivotKey, relatedPivotKey, parentKey, relatedKey);
    }

    /* -------------------------------------------------------------------------- */
    /*                             GLOBAL SCOPE REGISTRY                          */
    /* -------------------------------------------------------------------------- */

    /**
     * Register a global scope on this model class.
     * Global scopes are automatically applied to every query on the model.
     *
     * Call this inside a static boot() method on your model:
     *
     *   static boot() {
     *     super.boot();
     *     this.addGlobalScope('active', (builder) => builder.where('status', 'active'));
     *   }
     */
    public static addGlobalScope<T extends BaseModel>(
        this: new (attrs?: Record<string, any>) => T,
        name: string,
        callback: GlobalScopeCallback<T>
    ): void {
        const className = (this as any).name;
        if (!globalScopeRegistry.has(className)) {
            globalScopeRegistry.set(className, new Map());
        }
        globalScopeRegistry.get(className)!.set(name, callback as GlobalScopeCallback<any>);
    }

    /**
     * Get all global scopes registered for this model class (including parent classes).
     * @internal
     */
    public static getAllGlobalScopes<T extends BaseModel>(
        this: new (attrs?: Record<string, any>) => T
    ): Map<string, GlobalScopeCallback<T>> {
        const result: Map<string, GlobalScopeCallback<T>> = new Map();

        // Walk the prototype chain upward to inherit parent global scopes
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let currentClass: any = this;
        const chain: string[] = [];
        while (currentClass && currentClass.name && currentClass !== Function.prototype) {
            chain.unshift(currentClass.name);
            currentClass = Object.getPrototypeOf(currentClass);
        }

        for (const className of chain) {
            const scopes = globalScopeRegistry.get(className);
            if (scopes) {
                for (const [name, cb] of scopes) {
                    result.set(name, cb as GlobalScopeCallback<T>);
                }
            }
        }

        return result;
    }

    /**
     * Override this in subclasses to register global scopes and other boot-time setup.
     * Always call super.boot() first.
     */
    public static boot(): void {
        // Auto-register soft delete global scope if the model has softDelete = true
        const dummy = new (this as any)();
        if (dummy.softDelete === true) {
            const col: string = dummy.deletedAtColumn ?? "deleted_at";
            (this as any).addGlobalScope("softDelete", (builder: EloquentBuilder<any>) => {
                builder.whereNull(col);
            });
        }
    }

    /**
     * Ensures boot() is called exactly once per model class (lazy, on first query).
     * @internal
     */
    private static ensureBooted(): void {
        const className = (this as any).name;
        if (!bootedModels.has(className)) {
            bootedModels.add(className);
            (this as any).boot();
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                         DATABASE CONNECTION & QUERY BUILDER                */
    /* -------------------------------------------------------------------------- */

    public static connection(): Knex {
        if (activeDriver === "mongodb") {
            throw new Error("[StruxJS Error]: Active driver is 'mongodb'. Call MongoConnection.getDb() for native mongo operations.");
        }
        if (!dbConnection) {
            throw new Error("[StruxJS ORM Error]: Database connection is not initialized yet. Call bootConnection() first.");
        }
        return dbConnection;
    }

    public static getActiveDriver(): "sql" | "mongodb" {
        return activeDriver;
    }

    /**
     * Boot connection engine globally using database configs (supports mysql, postgres, sqlite, and mongodb)
     */
    public static async bootConnection(dbConfigOptions: any): Promise<void> {
        if (dbConfigOptions.driver === "mongodb" || dbConfigOptions.client === "mongodb") {
            activeDriver = "mongodb";
            await MongoConnection.boot(dbConfigOptions);
            return;
        }

        if (dbConnection) {
            try {
                await dbConnection.destroy();
            } catch { /* ignore */ }
            dbConnection = null;
        }

        activeDriver = "sql";
        const clientName = dbConfigOptions.client || dbConfigOptions.driver;
        const isSqlite = clientName === "sqlite3" || clientName === "sqlite";

        let connectionOptions: any;
        if (isSqlite) {
            connectionOptions = {
                filename: dbConfigOptions.filename || (typeof dbConfigOptions.connection === "object" ? dbConfigOptions.connection.filename : undefined) || "./database/database.sqlite"
            };
        } else {
            connectionOptions = (typeof dbConfigOptions.connection === "object" && !dbConfigOptions.connection.filename) ? dbConfigOptions.connection : {
                host: dbConfigOptions.host || "127.0.0.1",
                port: Number(dbConfigOptions.port) || (clientName === "postgres" || clientName === "pg" ? 5432 : 3306),
                user: dbConfigOptions.user || "root",
                password: dbConfigOptions.password || "",
                database: dbConfigOptions.database || "struxjs"
            };
        }

        dbConnection = knex({
            client: (clientName === "postgres" || clientName === "pg") ? "pg" : (isSqlite ? "sqlite3" : "mysql2"),
            connection: connectionOptions,
            useNullAsDefault: isSqlite
        });

        const queryTimes = new Map<string, number>();

        dbConnection.on("query", (queryData) => {
            const uid = queryData.__knexQueryUid;
            if (uid) queryTimes.set(uid, Date.now());
        });

        dbConnection.on("query-response", (_response, queryData) => {
            const uid = queryData.__knexQueryUid;
            const startTime = uid ? queryTimes.get(uid) : undefined;
            if (uid) queryTimes.delete(uid);

            const isEnabled = Boolean(
                dbConfigOptions?.log_queries ??
                dbConfigOptions?.logQueries ??
                config("database.log_queries") ??
                env("DB_LOG_QUERIES", env("DB_DEBUG", false))
            );

            if (!isEnabled) return;

            const duration = startTime ? Date.now() - startTime : 0;
            const sql = formatSql(queryData.sql, queryData.bindings);
            console.log(`\x1b[34m[SQL Query]\x1b[0m ${sql} \x1b[33m(${duration}ms)\x1b[0m`);
        });

        dbConnection.on("query-error", (error, queryData) => {
            const uid = queryData.__knexQueryUid;
            if (uid) queryTimes.delete(uid);

            const isEnabled = Boolean(
                dbConfigOptions?.log_queries ??
                dbConfigOptions?.logQueries ??
                config("database.log_queries") ??
                env("DB_LOG_QUERIES", env("DB_DEBUG", false))
            );

            if (!isEnabled) return;

            const sql = formatSql(queryData.sql, queryData.bindings);
            console.log(`\x1b[31m[SQL Error]\x1b[0m ${sql} — ${error.message}`);
        });
    }

    /**
     * Execute an automatic transaction callback
     */
    public static async transaction<T>(callback: (trx: any) => Promise<T>): Promise<T> {
        const { DB } = await import("./DB.js");
        return await DB.transaction(callback);
    }

    /**
     * Start a manual transaction
     */
    public static async beginTransaction(): Promise<any> {
        const { DB } = await import("./DB.js");
        return await DB.beginTransaction();
    }

    /**
     * Commit a manual transaction
     */
    public static async commit(trx: any): Promise<void> {
        const { DB } = await import("./DB.js");
        await DB.commit(trx);
    }

    /**
     * Rollback a manual transaction
     */
    public static async rollback(trx: any): Promise<void> {
        const { DB } = await import("./DB.js");
        await DB.rollback(trx);
    }

    /**
     * Start a new Eloquent Query Builder for this Model
     */
    public static query<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, trx?: any): EloquentBuilder<T> {
        // Ensure boot() has been called for this model class (registers global scopes etc.)
        (this as any).ensureBooted();

        const dummyInstance = new (this as any)();
        const tableName = dummyInstance.table || `${dummyInstance.constructor.name.toLowerCase()}s`;

        let builder: EloquentBuilder<T>;

        if (activeDriver === "mongodb") {
            builder = new EloquentBuilder<T>(this, undefined, dummyInstance.primaryKey, "mongodb");
        } else {
            const knexQuery = BaseModel.connection()(tableName);
            builder = new EloquentBuilder<T>(this, knexQuery, dummyInstance.primaryKey, "sql");
            if (trx) builder.transacting(trx);
        }

        // Register all global scopes defined on this model (via boot() or addGlobalScope())
        const globalScopes = (this as any).getAllGlobalScopes();
        for (const [name, callback] of globalScopes) {
            builder.addGlobalScope(name, callback);
        }

        return builder;
    }

    /* -------------------------------------------------------------------------- */
    /*                         STATIC ELOQUENT PROXY METHODS                      */
    /* -------------------------------------------------------------------------- */

    /**
     * Apply a named local scope to the query.
     * Usage: User.scope('active').get()
     *        User.scope('ofType', 'admin').get()
     */
    public static scope<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, name: string, ...args: any[]): EloquentBuilder<T> {
        return (this as any).query().scope(name, ...args);
    }

    /**
     * Exclude a specific global scope from this query.
     * Usage: User.withoutGlobalScope('active').get()
     */
    public static withoutGlobalScope<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, name: string): EloquentBuilder<T> {
        return (this as any).query().withoutGlobalScope(name);
    }

    /**
     * Exclude multiple (or all) global scopes from this query.
     * Usage: User.withoutGlobalScopes().get()
     *        User.withoutGlobalScopes('active', 'verified').get()
     */
    public static withoutGlobalScopes<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ...names: string[]): EloquentBuilder<T> {
        return (this as any).query().withoutGlobalScopes(...names);
    }

    public static with<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ...relations: string[]): EloquentBuilder<T> {
        return (this as any).query().with(...relations);
    }

    public static withCount<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ...relations: string[]): EloquentBuilder<T> {
        return (this as any).query().withCount(...relations);
    }

    public static has<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string): EloquentBuilder<T> {
        return (this as any).query().has(relationName);
    }

    public static doesntHave<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string): EloquentBuilder<T> {
        return (this as any).query().doesntHave(relationName);
    }

    public static whereHas<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, callback?: (query: EloquentBuilder<any>) => void): EloquentBuilder<T> {
        return (this as any).query().whereHas(relationName, callback);
    }

    public static orWhereHas<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, callback?: (query: EloquentBuilder<any>) => void): EloquentBuilder<T> {
        return (this as any).query().orWhereHas(relationName, callback);
    }

    public static whereDoesntHave<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, callback?: (query: EloquentBuilder<any>) => void): EloquentBuilder<T> {
        return (this as any).query().whereDoesntHave(relationName, callback);
    }

    public static where<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string | Record<string, any> | ((...args: any[]) => any), operator?: any, value?: any): EloquentBuilder<T> {
        return (this as any).query().where(column, operator, value);
    }

    public static orWhere<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string | Record<string, any>, operator?: any, value?: any): EloquentBuilder<T> {
        return (this as any).query().orWhere(column, operator, value);
    }

    public static whereIn<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, values: any[] | EloquentBuilder | ((...args: any[]) => any)): EloquentBuilder<T> {
        return (this as any).query().whereIn(column, values);
    }

    public static whereNotIn<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, values: any[] | EloquentBuilder | ((...args: any[]) => any)): EloquentBuilder<T> {
        return (this as any).query().whereNotIn(column, values);
    }

    public static whereExists<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, callback: EloquentBuilder | ((...args: any[]) => any)): EloquentBuilder<T> {
        return (this as any).query().whereExists(callback);
    }

    public static whereNotExists<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, callback: EloquentBuilder | ((...args: any[]) => any)): EloquentBuilder<T> {
        return (this as any).query().whereNotExists(callback);
    }

    public static selectSub<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, subQuery: EloquentBuilder | ((...args: any[]) => any), alias: string): EloquentBuilder<T> {
        return (this as any).query().selectSub(subQuery, alias);
    }

    public static selectRaw<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, sql: string, bindings: any[] = []): EloquentBuilder<T> {
        return (this as any).query().selectRaw(sql, bindings);
    }

    public static whereRaw<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, sql: string, bindings: any[] = []): EloquentBuilder<T> {
        return (this as any).query().whereRaw(sql, bindings);
    }

    public static whereBetween<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, range: [any, any]): EloquentBuilder<T> {
        return (this as any).query().whereBetween(column, range);
    }

    public static whereNotBetween<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, range: [any, any]): EloquentBuilder<T> {
        return (this as any).query().whereNotBetween(column, range);
    }

    public static whereNull<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): EloquentBuilder<T> {
        return (this as any).query().whereNull(column);
    }

    public static whereNotNull<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): EloquentBuilder<T> {
        return (this as any).query().whereNotNull(column);
    }

    public static whereColumn<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, first: string, operatorOrSecond: string, second?: string): EloquentBuilder<T> {
        return (this as any).query().whereColumn(first, operatorOrSecond, second);
    }

    public static fromSub<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, subQuery: EloquentBuilder | ((...args: any[]) => any), alias: string): EloquentBuilder<T> {
        return (this as any).query().fromSub(subQuery, alias);
    }

    public static when<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, value: any, callback: (builder: EloquentBuilder<T>, value: any) => void, defaultCallback?: (builder: EloquentBuilder<T>, value: any) => void): EloquentBuilder<T> {
        return (this as any).query().when(value, callback, defaultCallback);
    }

    public static unless<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, value: any, callback: (builder: EloquentBuilder<T>, value: any) => void, defaultCallback?: (builder: EloquentBuilder<T>, value: any) => void): EloquentBuilder<T> {
        return (this as any).query().unless(value, callback, defaultCallback);
    }

    public static select<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ...columns: string[]): EloquentBuilder<T> {
        return (this as any).query().select(...columns);
    }

    public static orderBy<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, direction: "asc" | "desc" = "asc"): EloquentBuilder<T> {
        return (this as any).query().orderBy(column, direction);
    }

    public static orderByRaw<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, sql: string, bindings: any[] = []): EloquentBuilder<T> {
        return (this as any).query().orderByRaw(sql, bindings);
    }

    public static latest<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column = "created_at"): EloquentBuilder<T> {
        return (this as any).query().latest(column);
    }

    public static oldest<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column = "created_at"): EloquentBuilder<T> {
        return (this as any).query().oldest(column);
    }

    public static limit<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, count: number): EloquentBuilder<T> {
        return (this as any).query().limit(count);
    }

    public static take<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, count: number): EloquentBuilder<T> {
        return (this as any).query().take(count);
    }

    public static groupBy<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ...columns: string[]): EloquentBuilder<T> {
        return (this as any).query().groupBy(...columns);
    }

    public static having<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, operator?: any, value?: any): EloquentBuilder<T> {
        return (this as any).query().having(column, operator, value);
    }

    public static havingRaw<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, sql: string, bindings: any[] = []): EloquentBuilder<T> {
        return (this as any).query().havingRaw(sql, bindings);
    }

    public static whereRelation<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string, operator?: any, value?: any): EloquentBuilder<T> {
        return (this as any).query().whereRelation(relationName, column, operator, value);
    }

    public static orWhereRelation<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string, operator?: any, value?: any): EloquentBuilder<T> {
        return (this as any).query().orWhereRelation(relationName, column, operator, value);
    }

    public static withSum<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string): EloquentBuilder<T> {
        return (this as any).query().withSum(relationName, column);
    }

    public static withAvg<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string): EloquentBuilder<T> {
        return (this as any).query().withAvg(relationName, column);
    }

    public static withMin<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string): EloquentBuilder<T> {
        return (this as any).query().withMin(relationName, column);
    }

    public static withMax<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, relationName: string, column: string): EloquentBuilder<T> {
        return (this as any).query().withMax(relationName, column);
    }

    public static async pluck<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string, key?: string): Promise<any[] | Record<string, any>> {
        return (this as any).query().pluck(column, key);
    }

    public static async value<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): Promise<any> {
        return (this as any).query().value(column);
    }

    public static async all<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<Collection<T>> {
        return (this as any).query().all();
    }

    public static async get<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<Collection<T>> {
        return (this as any).query().get();
    }

    public static async first<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<T | null> {
        return (this as any).query().first();
    }

    public static async firstOrFail<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<T> {
        return (this as any).query().firstOrFail();
    }

    public static async find<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, id: any): Promise<T | null> {
        return (this as any).query().find(id);
    }

    public static async findOrFail<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, id: any): Promise<T> {
        return (this as any).query().findOrFail(id);
    }

    public static async sole<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<T> {
        return (this as any).query().sole();
    }

    public static async soleOrFail<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<T> {
        return (this as any).query().soleOrFail();
    }

    public static async findManyOrFail<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ids: any[]): Promise<Collection<T>> {
        return (this as any).query().findManyOrFail(ids);
    }

    public static async create<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, attributes: Record<string, any>, options?: { transaction?: any }): Promise<T> {
        const dummyInstance = new (this as any)();
        const filteredAttributes = dummyInstance.filterFillable(attributes);
        const tableName = dummyInstance.table || `${dummyInstance.constructor.name.toLowerCase()}s`;

        // Hydrate filtered attributes into a fresh instance
        const instance = new (this as any)(filteredAttributes);
        instance.updateTimestampsForSave(true);
        const dataToInsert = instance.prepareAttributesForSave();

        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            const sessionOptions = options?.transaction ? { session: options.transaction } : {};
            const res = await db.collection(tableName).insertOne(dataToInsert, sessionOptions);
            dataToInsert._id = res.insertedId;
            dataToInsert.id = String(res.insertedId);
            return new (this as any)(dataToInsert);
        }

        let insertQuery = BaseModel.connection()(tableName);
        if (options?.transaction) {
            insertQuery = insertQuery.transacting(options.transaction);
        }

        const [insertedId] = await insertQuery.insert(dataToInsert);
        const idToFetch = insertedId || dataToInsert[dummyInstance.primaryKey];
        
        let fetchQuery = BaseModel.connection()(tableName).where(dummyInstance.primaryKey, idToFetch);
        if (options?.transaction) {
            fetchQuery = fetchQuery.transacting(options.transaction);
        }
        const row = await fetchQuery.first();
        return new (this as any)(row || dataToInsert);
    }

    public static async createMany<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, records: Record<string, any>[]): Promise<T[]> {
        const results: T[] = [];
        for (const record of records) {
            results.push(await (this as any).create(record));
        }
        return results;
    }

    public static async firstOrCreate<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, attributes: Record<string, any>, values: Record<string, any> = {}): Promise<T> {
        return (this as any).query().firstOrCreate(attributes, values);
    }

    public static async updateOrCreate<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, attributes: Record<string, any>, values: Record<string, any>): Promise<T> {
        return (this as any).query().updateOrCreate(attributes, values);
    }

    public static async count<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column = "*"): Promise<number> {
        return (this as any).query().count(column);
    }

    public static async max<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): Promise<any> {
        return (this as any).query().max(column);
    }

    public static async min<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): Promise<any> {
        return (this as any).query().min(column);
    }

    public static async avg<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): Promise<number> {
        return (this as any).query().avg(column);
    }

    public static async sum<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, column: string): Promise<number> {
        return (this as any).query().sum(column);
    }

    public static async exists<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<boolean> {
        return (this as any).query().exists();
    }

    public static async doesntExist<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): Promise<boolean> {
        return (this as any).query().doesntExist();
    }

    public static async paginate<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, perPage = 15, page = 1): Promise<PaginationResult<T>> {
        // Auto-detect page from request query if available
        let pageNum = page;
        try {
            const { request } = await import("../http/HttpContext.js");
            const req = request() as any;
            if (req.query?.page) {
                pageNum = Number(req.query.page) || 1;
            }
        } catch {
            // HTTP context not available (e.g. CLI, job) — use provided page
        }

        return (this as any).query().paginate(perPage, pageNum);
    }

    public static async destroy<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ids: any | any[]): Promise<number> {
        const dummyInstance = new (this as any)();
        const primaryKey = dummyInstance.primaryKey;
        const idList = Array.isArray(ids) ? ids : [ids];

        // Fetch instances first to fire model events for each deletion
        const models = await (this as any).query().whereIn(primaryKey, idList).get();
        let deletedCount = 0;

        for (const model of models.toArray()) {
            if (await model.delete()) {
                deletedCount++;
            }
        }

        return deletedCount;
    }

    /* -------------------------------------------------------------------------- */
    /*                         SOFT DELETE STATIC PROXY METHODS                   */
    /* -------------------------------------------------------------------------- */

    /**
     * Include soft-deleted records in query results.
     *
     * Post.withTrashed().get()
     */
    public static withTrashed<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): EloquentBuilder<T> {
        return (this as any).query().withTrashed();
    }

    /**
     * Query only soft-deleted records.
     *
     * Post.onlyTrashed().get()
     */
    public static onlyTrashed<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T): EloquentBuilder<T> {
        return (this as any).query().onlyTrashed();
    }

    /**
     * Restore soft-deleted records by primary key(s).
     *
     * await Post.restoreById(5);
     * await Post.restoreById([1, 2, 3]);
     */
    public static async restoreById<T extends BaseModel>(this: new (attrs?: Record<string, any>) => T, ids: any | any[]): Promise<number> {
        const dummyInstance = new (this as any)();
        const primaryKey = dummyInstance.primaryKey;
        const idList = Array.isArray(ids) ? ids : [ids];
        return (this as any).query().onlyTrashed().whereIn(primaryKey, idList).restore();
    }

    /* -------------------------------------------------------------------------- */
    /*                        MODEL INSTANCE METHODS                              */
    /* -------------------------------------------------------------------------- */

    /**
     * Filter input attributes through the fillable whitelist.
     * If fillable is empty, all keys pass through.
     */
    protected filterFillable(attributes: Record<string, any>): Record<string, any> {
        if (!this.fillable || this.fillable.length === 0) return attributes;
        const result: Record<string, any> = {};
        for (const key of this.fillable) {
            if (key in attributes) result[key] = attributes[key];
        }
        return result;
    }

    /**
     * Fill instance with attributes without saving.
     * Respects fillable whitelist when defined.
     */
    public fill(attributes: Record<string, any>): this {
        Object.assign(this.attributes, this.filterFillable(attributes));
        return this;
    }

    /**
     * Save or update model instance state back to database
     */
    public async save(): Promise<boolean> {
        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;
        const id = this.attributes.id || this.attributes._id;

        const isInsert = !id;
        
        // 1. Trigger saving event
        if (await this.onSaving() === false) return false;

        // 2. Trigger creating or updating event
        if (isInsert) {
            if (await this.onCreating() === false) return false;
        } else {
            if (await this.onUpdating() === false) return false;
        }

        this.updateTimestampsForSave(isInsert);
        const dataToSave = this.prepareAttributesForSave();

        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            if (id) {
                delete dataToSave._id;
                delete dataToSave.id;
                await db.collection(tableName).updateOne(
                    { _id: MongoConnection.toObjectId(id) },
                    { $set: dataToSave },
                    { upsert: true }
                );
            } else {
                const res = await db.collection(tableName).insertOne(dataToSave);
                this.attributes._id = res.insertedId;
                this.attributes.id = String(res.insertedId);
            }
        } else {
            if (id) {
                await BaseModel.connection()(tableName).where(this.primaryKey, id).update(dataToSave);
            } else {
                const [insertedId] = await BaseModel.connection()(tableName).insert(dataToSave);
                this.attributes[this.primaryKey] = insertedId || this.attributes[this.primaryKey];
            }
        }

        // 3. Trigger saved event
        await this.onSaved();

        // 4. Trigger created or updated event
        if (isInsert) {
            await this.onCreated();
            await this.dispatchModelBroadcast("created");
        } else {
            await this.onUpdated();
            await this.dispatchModelBroadcast("updated");
        }

        return true;
    }

    /**
     * Update model attributes and save to database
     */
    public async update(attributes: Record<string, any>): Promise<boolean> {
        this.fill(attributes);
        return await this.save();
    }

    /**
     * Delete model instance from database.
     * If softDelete = true, sets deleted_at instead of removing the row.
     */
    public async delete(): Promise<boolean> {
        const id = this.attributes.id || this.attributes._id;
        if (!id) return false;

        if (await this.onDeleting() === false) return false;

        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;

        // SOFT DELETE path
        if (this.softDelete) {
            const col = this.deletedAtColumn ?? "deleted_at";
            const now = new Date();
            this.attributes[col] = now;

            if (activeDriver === "mongodb") {
                const db = MongoConnection.getDb();
                await db.collection(tableName).updateOne(
                    { _id: MongoConnection.toObjectId(id) },
                    { $set: { [col]: now } }
                );
            } else {
                await BaseModel.connection()(tableName).where(this.primaryKey, id).update({ [col]: now });
            }

            await this.onDeleted();
            await this.dispatchModelBroadcast("deleted");
            return true;
        }

        // HARD DELETE path
        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(tableName).deleteOne({ _id: MongoConnection.toObjectId(id) });
            await this.onDeleted();
            await this.dispatchModelBroadcast("deleted");
            return true;
        }

        await BaseModel.connection()(tableName).where(this.primaryKey, id).delete();
        await this.onDeleted();
        await this.dispatchModelBroadcast("deleted");
        return true;
    }

    /**
     * Restore a soft-deleted model instance (sets deleted_at back to NULL).
     * Only works when softDelete = true.
     *
     * await post.restore();
     */
    public async restore(): Promise<boolean> {
        if (!this.softDelete) return false;

        const id = this.attributes.id || this.attributes._id;
        if (!id) return false;

        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;
        const col = this.deletedAtColumn ?? "deleted_at";

        this.attributes[col] = null;

        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(tableName).updateOne(
                { _id: MongoConnection.toObjectId(id) },
                { $set: { [col]: null } }
            );
            return true;
        }

        await BaseModel.connection()(tableName).where(this.primaryKey, id).update({ [col]: null });
        return true;
    }

    /**
     * Permanently delete a soft-deleted model instance from the database.
     *
     * await post.forceDelete();
     */
    public async forceDelete(): Promise<boolean> {
        const id = this.attributes.id || this.attributes._id;
        if (!id) return false;

        if (await this.onDeleting() === false) return false;

        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;

        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(tableName).deleteOne({ _id: MongoConnection.toObjectId(id) });
            await this.onDeleted();
            return true;
        }

        await BaseModel.connection()(tableName).where(this.primaryKey, id).delete();
        await this.onDeleted();
        return true;
    }

    /**
     * Check whether this model instance has been soft-deleted.
     *
     * if (post.trashed()) { ... }
     */
    public trashed(): boolean {
        const col = this.deletedAtColumn ?? "deleted_at";
        return this.softDelete && this.attributes[col] != null;
    }

    /**
     * Refresh model attributes from database
     */
    public async refresh(): Promise<this> {
        const id = this.attributes.id || this.attributes._id;
        if (!id) return this;

        const tableName = this.table || `${this.constructor.name.toLowerCase()}s`;

        if (activeDriver === "mongodb") {
            const db = MongoConnection.getDb();
            const row = await db.collection(tableName).findOne({ _id: MongoConnection.toObjectId(id) });
            if (row) {
                row.id = String(row._id);
                this.attributes = { ...row };
            }
            return this;
        }

        const row = await BaseModel.connection()(tableName).where(this.primaryKey, id).first();
        if (row) {
            this.attributes = { ...row };
        }
        return this;
    }

    /**
     * Convert model instance to plain object (with cast values)
     */
    public toArray(): Record<string, any> {
        const result: Record<string, any> = {};

        // Cast attributes for serialization
        Object.keys(this.attributes).forEach(key => {
            result[key] = (this as any)[key];
        });

        // Append loaded relations into plain object
        Object.keys(this.relations).forEach(key => {
            const val = this.relations[key];
            if (Array.isArray(val)) {
                result[key] = val.map(item => typeof item?.toArray === "function" ? item.toArray() : item);
            } else if (val && typeof val.toArray === "function") {
                result[key] = val.toArray();
            } else {
                result[key] = val;
            }
        });

        return result;
    }

    /**
     * Alias for toArray()
     */
    public toJSON(): Record<string, any> {
        return this.toArray();
    }

    /* -------------------------------------------------------------------------- */
    /*                         MODEL EVENT LIFECYCLE HOOKS                        */
    /* -------------------------------------------------------------------------- */

    /** Override these hooks to interact with model events */
    protected async onCreating(): Promise<boolean | void> {}
    protected async onCreated(): Promise<void> {}
    protected async onUpdating(): Promise<boolean | void> {}
    protected async onUpdated(): Promise<void> {}
    protected async onSaving(): Promise<boolean | void> {}
    protected async onSaved(): Promise<void> {}
    protected async onDeleting(): Promise<boolean | void> {}
    protected async onDeleted(): Promise<void> {}

    /** Dump model instance attributes without halting execution */
    public dump(): this {
        dump(this);
        return this;
    }

    /** Dump model instance attributes and halt execution */
    public dd(): any {
        return dd(this);
    }
}

function formatSql(sql: string, bindings: any[] = []): string {
    if (!bindings || bindings.length === 0) return sql;
    let index = 0;
    return sql.replace(/\?/g, () => {
        if (index >= bindings.length) return "?";
        const val = bindings[index++];
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "number" || typeof val === "boolean") return String(val);
        if (val instanceof Date) return `'${val.toISOString()}'`;
        return `'${String(val).replace(/'/g, "\\'")}'`;
    });
}
