import { SessionDriverInterface } from "./SessionDriverInterface.js";

export class MemorySessionDriver implements SessionDriverInterface {
    private static store = new Map<string, { data: Record<string, any>; expiresAt: number }>();

    public async read(id: string): Promise<Record<string, any> | null> {
        const item = MemorySessionDriver.store.get(id);
        if (!item) return null;

        if (Date.now() > item.expiresAt) {
            MemorySessionDriver.store.delete(id);
            return null;
        }

        return item.data;
    }

    public async write(id: string, data: Record<string, any>, lifetimeMinutes: number): Promise<void> {
        const expiresAt = Date.now() + (lifetimeMinutes * 60 * 1000);
        MemorySessionDriver.store.set(id, { data, expiresAt });
    }

    public async destroy(id: string): Promise<void> {
        MemorySessionDriver.store.delete(id);
    }
}
