/**
 * Resource — abstract base class for API resource transformers.
 *
 * Usage:
 *   export class UserResource extends Resource {
 *       transform(user: any) {
 *           return {
 *               id:    user.id,
 *               name:  user.name,
 *               email: user.email,
 *           };
 *       }
 *   }
 *
 *   // In controller:
 *   return new UserResource(user);
 *   return new UserResource(user).additional({ meta: "value" });
 *   return UserResource.make(user);
 *   return UserResource.collection(users);
 */
export abstract class Resource {
    /** The underlying model/data being transformed */
    protected model: any;

    /** Extra top-level fields merged into response */
    private _additional: Record<string, any> = {};

    /** HTTP status code — default 200 */
    private _status: number = 200;

    /** Response wrapper key. null = no wrapping */
    private static defaultWrap: string | null = "data";

    constructor(model: any) {
        this.model = model;
    }

    /* ------------------------------------------------------------------ */
    /*  Abstract                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Transform the model into an array/object.
     * Override this in your Resource class.
     */
    public abstract transform(model: any): Record<string, any> | Promise<Record<string, any>>;

    /* ------------------------------------------------------------------ */
    /*  Static factory helpers                                             */
    /* ------------------------------------------------------------------ */

    /** Create a single resource instance. */
    public static make<T extends Resource>(
        this: new (model: any) => T,
        model: any
    ): T {
        return new this(model);
    }

    /**
     * Create a ResourceCollection from an array or pagination result.
     *
     *   return UserResource.collection(users);
     *   return UserResource.collection(await User.paginate(15, 1));
     */
    public static collection<T extends Resource>(
        this: new (model: any) => T,
        data: any[] | { data: any[]; [key: string]: any }
    ): ResourceCollection<T> {
        return new ResourceCollection(this as any, data);
    }

    /* ------------------------------------------------------------------ */
    /*  Fluent modifiers                                                   */
    /* ------------------------------------------------------------------ */

    /** Merge extra fields into the top-level response object. */
    public additional(data: Record<string, any>): this {
        this._additional = { ...this._additional, ...data };
        return this;
    }

    /** Override the HTTP status code for this response. */
    public withStatus(code: number): this {
        this._status = code;
        return this;
    }

    /* ------------------------------------------------------------------ */
    /*  Wrap configuration                                                 */
    /* ------------------------------------------------------------------ */

    /** Set the global default wrap key (e.g. "data"). Pass null to disable. */
    public static wrap(key: string | null): void {
        Resource.defaultWrap = key;
    }

    /** Disable wrapping globally. */
    public static withoutWrapping(): void {
        Resource.defaultWrap = null;
    }

    /* ------------------------------------------------------------------ */
    /*  Serialization                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Resolve the resource to a plain JSON-safe object.
     * Called automatically by the Router before sending the response.
     * @internal
     */
    public async resolve(): Promise<{ status: number; body: Record<string, any> }> {
        // Unwrap BaseModel to plain attributes if needed
        const raw = this.unwrapModel(this.model);

        const transformed = await this.transform(raw);

        const body: Record<string, any> = Resource.defaultWrap
            ? { [Resource.defaultWrap]: transformed, ...this._additional }
            : { ...transformed, ...this._additional };

        return { status: this._status, body };
    }

    /**
     * Unwrap a BaseModel (or plain object) to a plain attributes object.
     * Supports BaseModel instances, plain objects, and primitives.
     */
    protected unwrapModel(model: any): any {
        if (!model) return model;

        // BaseModel instance — extract attributes + loaded relations
        if (typeof model === "object" && model.attributes && typeof model.attributes === "object") {
            const attrs = { ...model.attributes };
            // Merge loaded relations
            if (model.relations && typeof model.relations === "object") {
                for (const [key, value] of Object.entries(model.relations)) {
                    attrs[key] = value;
                }
            }
            return attrs;
        }

        // toJSON / toObject support
        if (typeof model.toJSON === "function") return model.toJSON();
        if (typeof model.toObject === "function") return model.toObject();

        return model;
    }

    /** Allow instanceof check: Resource.isResource(value) */
    public static isResource(value: any): value is Resource {
        return value instanceof Resource;
    }
}

/* ====================================================================== */
/*  ResourceCollection                                                     */
/* ====================================================================== */

/**
 * ResourceCollection — transforms an array or pagination result.
 *
 *   return UserResource.collection(users);
 *   return UserResource.collection(await User.paginate(15, page));
 *
 * Pagination output:
 *   {
 *     "data": [...],
 *     "meta": { "total": 100, "per_page": 15, "current_page": 1, ... }
 *   }
 */
export class ResourceCollection<T extends Resource = Resource> {
    private _additional: Record<string, any> = {};
    private _status: number = 200;
    private isPagination: boolean = false;
    private paginationMeta: Record<string, any> = {};
    private items: any[] = [];

    constructor(
        private ResourceClass: new (model: any) => T,
        data: any[] | { data: any[]; [key: string]: any }
    ) {
        // Detect pagination result (has data + pagination meta)
        if (!Array.isArray(data) && data && Array.isArray(data.data)) {
            this.isPagination = true;
            this.items = data.data;

            // Extract pagination metadata
            const { data: _, ...meta } = data;
            this.paginationMeta = meta;
        } else {
            this.items = data as any[];
        }
    }

    /** Merge extra fields into the top-level response. */
    public additional(data: Record<string, any>): this {
        this._additional = { ...this._additional, ...data };
        return this;
    }

    /** Override HTTP status code. */
    public withStatus(code: number): this {
        this._status = code;
        return this;
    }

    /**
     * Resolve to a plain JSON-safe object.
     * @internal
     */
    public async resolve(): Promise<{ status: number; body: Record<string, any> }> {
        const transformed = await Promise.all(
            this.items.map(async item => {
                const resource = new this.ResourceClass(item);
                const raw = (resource as any).unwrapModel(item);
                return await resource.transform(raw);
            })
        );

        const body: Record<string, any> = {
            data: transformed,
            ...this._additional
        };

        if (this.isPagination) {
            body.meta = this.buildMeta(this.paginationMeta);
            body.links = this.buildLinks(this.paginationMeta);
        }

        return { status: this._status, body };
    }

    private buildMeta(meta: Record<string, any>): Record<string, any> {
        return {
            total:        meta.total        ?? null,
            per_page:     meta.perPage      ?? meta.per_page ?? null,
            current_page: meta.currentPage  ?? meta.current_page ?? null,
            last_page:    meta.lastPage     ?? meta.last_page ?? null,
            from:         meta.from         ?? null,
            to:           meta.to           ?? null
        };
    }

    private buildLinks(meta: Record<string, any>): Record<string, any> {
        const current = meta.currentPage ?? meta.current_page ?? 1;
        const last    = meta.lastPage    ?? meta.last_page    ?? 1;

        return {
            first: `?page=1`,
            last:  `?page=${last}`,
            prev:  current > 1    ? `?page=${current - 1}` : null,
            next:  current < last ? `?page=${current + 1}` : null
        };
    }

    public static isResourceCollection(value: any): value is ResourceCollection {
        return value instanceof ResourceCollection;
    }
}
