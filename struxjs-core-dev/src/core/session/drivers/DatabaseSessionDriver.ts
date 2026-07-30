import { SessionDriverInterface } from "./SessionDriverInterface.js";
import { BaseModel } from "../../database/BaseModel.js";
import { MongoConnection } from "../../database/MongoConnection.js";

export class DatabaseSessionDriver implements SessionDriverInterface {
    constructor(private tableName = "sessions") {}

    public async read(id: string): Promise<Record<string, any> | null> {
        const driver = BaseModel.getActiveDriver();
        const nowUnix = Math.floor(Date.now() / 1000);

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            const record = await db.collection(this.tableName).findOne({ _id: id as any });
            if (!record) return null;

            if (record.last_activity && record.last_activity < nowUnix) {
                await this.destroy(id);
                return null;
            }

            try {
                return JSON.parse(record.payload);
            } catch {
                return null;
            }
        }

        const db = BaseModel.connection();
        const record = await db(this.tableName).where("id", id).first();
        if (!record) return null;

        if (record.last_activity && record.last_activity < nowUnix) {
            await this.destroy(id);
            return null;
        }

        try {
            return JSON.parse(record.payload);
        } catch {
            return null;
        }
    }

    public async write(id: string, data: Record<string, any>, lifetimeMinutes: number): Promise<void> {
        const driver = BaseModel.getActiveDriver();
        const nowUnix = Math.floor(Date.now() / 1000);
        const expiresAtUnix = nowUnix + (lifetimeMinutes * 60);

        const userId = data.attributes?.user_id || null;
        const payloadStr = JSON.stringify(data);

        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(this.tableName).updateOne(
                { _id: id as any },
                {
                    $set: {
                        user_id: userId,
                        payload: payloadStr,
                        last_activity: expiresAtUnix
                    }
                },
                { upsert: true }
            );
            return;
        }

        const db = BaseModel.connection();
        const exist = await db(this.tableName).where("id", id).first();
        if (exist) {
            await db(this.tableName).where("id", id).update({
                user_id: userId,
                payload: payloadStr,
                last_activity: expiresAtUnix
            });
        } else {
            await db(this.tableName).insert({
                id,
                user_id: userId,
                payload: payloadStr,
                last_activity: expiresAtUnix
            });
        }
    }

    public async destroy(id: string): Promise<void> {
        const driver = BaseModel.getActiveDriver();
        if (driver === "mongodb") {
            const db = MongoConnection.getDb();
            await db.collection(this.tableName).deleteOne({ _id: id as any });
            return;
        }

        const db = BaseModel.connection();
        await db(this.tableName).where("id", id).delete();
    }
}
