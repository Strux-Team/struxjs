import { MongoClient, Db, ObjectId } from "mongodb";

let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

export class MongoConnection {
    /**
     * Boot MongoDB client and connection pool asynchronously
     */
    public static async boot(config: any): Promise<Db> {
        if (!mongoDb) {
            const host = config.host || "127.0.0.1";
            const port = config.port || 27017;
            const database = config.database || "struxjs";
            
            let url = config.url || config.connection?.url;
            if (!url) {
                if (config.user && config.password) {
                    url = `mongodb://${config.user}:${config.password}@${host}:${port}/${database}?authSource=admin`;
                } else {
                    url = `mongodb://${host}:${port}/${database}`;
                }
            }

            mongoClient = new MongoClient(url);
            await mongoClient.connect();
            mongoDb = mongoClient.db(database);
        }
        return mongoDb;
    }

    /**
     * Get active MongoDB Db instance
     */
    public static getDb(): Db {
        if (!mongoDb) {
            throw new Error("[StruxJS Mongo Error]: MongoDB connection is not booted. Call bootConnection({ driver: 'mongodb', ... }) first.");
        }
        return mongoDb;
    }

    /**
     * Get active MongoClient instance
     */
    public static getClient(): MongoClient {
        if (!mongoClient) {
            throw new Error("[StruxJS Mongo Error]: MongoDB client is not booted.");
        }
        return mongoClient;
    }

    /**
     * Safely convert string to BSON ObjectId
     */
    public static toObjectId(id: any): any {
        if (!id) return id;
        if (id instanceof ObjectId) return id;
        if (typeof id === "string" && ObjectId.isValid(id) && id.length === 24) {
            try {
                return new ObjectId(id);
            } catch {
                return id;
            }
        }
        return id;
    }
}
