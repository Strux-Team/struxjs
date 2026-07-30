export interface SessionDriverInterface {
    /**
     * Read session payload by ID
     */
    read(id: string): Promise<Record<string, any> | null>;

    /**
     * Write session payload by ID with lifetime expiration
     */
    write(id: string, data: Record<string, any>, lifetimeMinutes: number): Promise<void>;

    /**
     * Destroy session by ID
     */
    destroy(id: string): Promise<void>;
}
