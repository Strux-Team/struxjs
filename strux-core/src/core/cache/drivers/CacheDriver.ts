/**
 * CacheDriver — interface mọi cache backend phải implement.
 */
export interface CacheDriver {
    /** Retrieve an item. Returns null if missing or expired. */
    get<T = any>(key: string): Promise<T | null>;

    /** Retrieve multiple items at once. Missing keys return null. */
    many<T = any>(keys: string[]): Promise<Record<string, T | null>>;

    /** Store an item. ttl = seconds (0 or omitted = forever). */
    put<T = any>(key: string, value: T, ttl?: number): Promise<void>;

    /** Store multiple items at once with the same TTL. */
    putMany<T = any>(values: Record<string, T>, ttl?: number): Promise<void>;

    /** Check if an item exists and has not expired. */
    has(key: string): Promise<boolean>;

    /** Remove an item. */
    forget(key: string): Promise<boolean>;

    /** Remove all items from this store. */
    flush(): Promise<void>;

    /** Increment a numeric value. Returns the new value. */
    increment(key: string, by?: number): Promise<number>;

    /** Decrement a numeric value. Returns the new value. */
    decrement(key: string, by?: number): Promise<number>;
}
