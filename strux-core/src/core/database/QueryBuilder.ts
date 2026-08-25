import { Knex } from "knex";
import collect, { Collection } from "collect.js";
import { BaseModel } from "./BaseModel.js";
import { Relation } from "./relations/Relation.js";
import { BelongsToMany } from "./relations/BelongsToMany.js";
import { MongoConnection } from "./MongoConnection.js";
import { TemplateEngine } from "../view/TemplateEngine.js";
import { httpContextStorage, dd, dump } from "../http/HttpContext.js";

declare module "collect.js" {
    interface Collection<Item> {
        forEach(callback: (item: Item, index: number) => void): void;
        dd(): void;
        dump(): this;
        [Symbol.iterator](): Iterator<Item>;
    }
}

if (!(Collection.prototype as any).dd) {
    (Collection.prototype as any).dd = function () {
        return dd(this);
    };
    (Collection.prototype as any).dump = function () {
        dump(this);
        return this;
    };
}

if (!(Collection.prototype as any).forEach) {
    (Collection.prototype as any).forEach = function (callback: (item: any, index: number) => void) {
        return this.all().forEach(callback);
    };
}

if (!(Collection.prototype as any)[Symbol.iterator]) {
    (Collection.prototype as any)[Symbol.iterator] = function* () {
        const items = this.all();
        for (const item of items) {
            yield item;
        }
    };
}

export { collect, Collection };

export class PaginationResult<T> {
    public data: Collection<T>;
    public total: number;
    public perPage: number;
    public currentPage: number;
    public lastPage: number;
    public from: number;
    public to: number;

    // Internal state for query string preservation
    private preserveQueryString: boolean = false;

    constructor(data: Collection<T>, total: number, perPage: number, currentPage: number) {
        this.data = data;
        this.total = total;
        this.perPage = perPage;
        this.currentPage = currentPage;
        this.lastPage = Math.ceil(total / perPage);
        this.from = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
        this.to = Math.min(currentPage * perPage, total);
    }

    /**
     * Make PaginationResult iterable directly via for...of or Array.from()
     */
    public *[Symbol.iterator](): Iterator<T> {
        const items = this.data.all();
        for (const item of items) {
            yield item;
        }
    }

    /**
     * Extract raw array items
     */
    public all(): T[] {
        return this.data.all();
    }

    /**
     * Array-like map method directly on PaginationResult
     */
    public map<U>(callback: (item: T, index: number) => U): U[] {
        return this.data.all().map(callback);
    }

    /**
     * Array-like forEach method directly on PaginationResult
     */
    public forEach(callback: (item: T, index: number) => void): void {
        this.data.all().forEach(callback);
    }

    /**
     * Preserve all query string parameters (except page) in pagination links.
     * Laravel equivalent: $users->withQueryString()
     * 
     * Returns a new instance — does not mutate the original.
     * 
     * Usage:
     *   const html = users.withQueryString().links();
     */
    public withQueryString(): PaginationResult<T> {
        const clone = new PaginationResult<T>(
            this.data,
            this.total,
            this.perPage,
            this.currentPage
        );
        clone.preserveQueryString = true;
        return clone;
    }

    /**
     * Generate HTML pagination links for templates.
     * Returns Tailwind CSS styled pagination (Bootstrap also supported).
     * 
     * Usage in view:
     * {!! users.links() !!}                        // Tailwind default
     * {!! users.links('bootstrap') !!}             // Bootstrap 5
     * {!! users.links('pagination.custom') !!}     // Custom view file
     */
    public links(styleOrView: string = 'tailwind'): string {
        if (this.lastPage <= 1) return '';

        if (styleOrView === 'bootstrap') {
            const pages = this.generatePagesArray();
            return this.renderBootstrap(pages.map(p => p.page), (p) => this.buildUrl(p));
        }

        if (styleOrView === 'tailwind') {
            const pages = this.generatePagesArray();
            return this.renderTailwind(pages.map(p => p.page), (p) => this.buildUrl(p));
        }

        // Custom view name: 'custom' -> 'pagination.custom', 'pagination.custom', 'partials.pagination'
        let viewPath = styleOrView;
        if (!viewPath.includes('.') && !viewPath.includes('/')) {
            viewPath = `pagination.${viewPath}`;
        }

        return this.renderCustomView(viewPath);
    }

    private renderCustomView(viewPath: string): string {
        try {
            const engine = new TemplateEngine();

            // Build pagination data for view
            const paginationData = {
                currentPage: this.currentPage,
                lastPage: this.lastPage,
                perPage: this.perPage,
                total: this.total,
                from: this.from,
                to: this.to,
                hasMorePages: this.currentPage < this.lastPage,
                onFirstPage: this.currentPage === 1,
                previousPageUrl: this.currentPage > 1 ? this.buildUrl(this.currentPage - 1) : null,
                nextPageUrl: this.currentPage < this.lastPage ? this.buildUrl(this.currentPage + 1) : null,
                firstPageUrl: this.buildUrl(1),
                lastPageUrl: this.buildUrl(this.lastPage),
                
                // Generate pages array
                pages: this.generatePagesArray(),
                
                // Helper method to build URLs
                url: (page: number) => this.buildUrl(page)
            };

            const result = engine.render(viewPath, { paginator: paginationData });
            return result;
        } catch (error: any) {
            console.error(`[StruxJS Pagination] Failed to render custom view '${viewPath}':`, error.message, error.stack);
            // Fallback to Tailwind if custom view fails
            return this.renderTailwindFallback();
        }
    }

    private renderTailwindFallback(): string {
        const pages = this.generatePagesArray();
        const buildUrl = (page: number) => this.buildUrl(page);
        return this.renderTailwind(pages.map(p => p.page), buildUrl);
    }

    private buildUrl(page: number): string {
        try {
            const store = httpContextStorage.getStore();
            if (!store) return `?page=${page}`;

            const req = store.request as any;
            // req.raw.url giữ nguyên URL gốc từ Node.js IncomingMessage
            const rawUrl = req.raw?.url ?? req.url ?? '';
            const baseUrl = rawUrl.split('?')[0];

            if (this.preserveQueryString) {
                // Preserve all existing query params, overwrite 'page'
                const currentQuery = rawUrl.split('?')[1] || '';
                const params = new URLSearchParams(currentQuery);
                params.set('page', String(page));
                return `${baseUrl}?${params.toString()}`;
            }

            return `${baseUrl}?page=${page}`;
        } catch {
            return `?page=${page}`;
        }
    }

    private generatePagesArray(): Array<{ page: number | string; url: string | null; active: boolean; disabled: boolean }> {
        const pages: Array<{ page: number | string; url: string | null; active: boolean; disabled: boolean }> = [];
        const showRange = 2;

        const addPage = (pageNum: number | string, active = false) => {
            pages.push({
                page: pageNum,
                url: typeof pageNum === 'number' ? this.buildUrl(pageNum) : null,
                active,
                disabled: pageNum === '...'
            });
        };

        addPage(1, this.currentPage === 1);

        if (this.currentPage > showRange + 2) {
            addPage('...');
        }

        for (let i = Math.max(2, this.currentPage - showRange); i <= Math.min(this.lastPage - 1, this.currentPage + showRange); i++) {
            addPage(i, i === this.currentPage);
        }

        if (this.currentPage < this.lastPage - showRange - 1) {
            addPage('...');
        }

        if (this.lastPage > 1) {
            addPage(this.lastPage, this.currentPage === this.lastPage);
        }

        return pages;
    }

    private renderTailwind(pages: Array<number | string>, buildUrl: (page: number) => string): string {
        const html: string[] = ['<nav class="flex items-center justify-center space-x-2 my-4">'];

        // Previous button
        if (this.currentPage > 1) {
            html.push(`<a href="${buildUrl(this.currentPage - 1)}" class="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Previous</a>`);
        } else {
            html.push(`<span class="px-3 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-300 rounded-md cursor-not-allowed">Previous</span>`);
        }

        // Page numbers
        pages.forEach(page => {
            if (page === '...') {
                html.push(`<span class="px-3 py-2 text-sm font-medium text-gray-700">...</span>`);
            } else if (page === this.currentPage) {
                html.push(`<span class="px-3 py-2 text-sm font-medium text-white bg-blue-600 border border-blue-600 rounded-md">${page}</span>`);
            } else {
                html.push(`<a href="${buildUrl(page as number)}" class="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">${page}</a>`);
            }
        });

        // Next button
        if (this.currentPage < this.lastPage) {
            html.push(`<a href="${buildUrl(this.currentPage + 1)}" class="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Next</a>`);
        } else {
            html.push(`<span class="px-3 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-300 rounded-md cursor-not-allowed">Next</span>`);
        }

        html.push('</nav>');
        return html.join('');
    }

    private renderBootstrap(pages: Array<number | string>, buildUrl: (page: number) => string): string {
        const html: string[] = ['<nav><ul class="pagination">'];

        // Previous button
        if (this.currentPage > 1) {
            html.push(`<li class="page-item"><a class="page-link" href="${buildUrl(this.currentPage - 1)}">Previous</a></li>`);
        } else {
            html.push(`<li class="page-item disabled"><span class="page-link">Previous</span></li>`);
        }

        // Page numbers
        pages.forEach(page => {
            if (page === '...') {
                html.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
            } else if (page === this.currentPage) {
                html.push(`<li class="page-item active"><span class="page-link">${page}</span></li>`);
            } else {
                html.push(`<li class="page-item"><a class="page-link" href="${buildUrl(page as number)}">${page}</a></li>`);
            }
        });

        // Next button
        if (this.currentPage < this.lastPage) {
            html.push(`<li class="page-item"><a class="page-link" href="${buildUrl(this.currentPage + 1)}">Next</a></li>`);
        } else {
            html.push(`<li class="page-item disabled"><span class="page-link">Next</span></li>`);
        }

        html.push('</ul></nav>');
        return html.join('');
    }
}

// Signature for a global scope: a callback that receives the builder
export type GlobalScopeCallback<T extends BaseModel = any> = (builder: QueryBuilder<T>) => void;
export class CursorPaginationResult<T> {
    public data: Collection<T>;
    public perPage: number;
    public nextCursor: string | null;
    public prevCursor: string | null;

    constructor(data: Collection<T>, perPage: number, nextCursor: string | null, prevCursor: string | null) {
        this.data = data;
        this.perPage = perPage;
        this.nextCursor = nextCursor;
        this.prevCursor = prevCursor;
    }

    public *[Symbol.iterator](): Iterator<T> {
        const items = this.data.all();
        for (const item of items) {
            yield item;
        }
    }

    public all(): T[] {
        return this.data.all();
    }

    public map<U>(callback: (item: T, index: number) => U): U[] {
        return this.data.all().map(callback);
    }

    public toJSON() {
        return {
            data: this.data.map(item => (typeof (item as any).toJSON === 'function' ? (item as any).toJSON() : item)),
            per_page: this.perPage,
            next_cursor: this.nextCursor,
            prev_cursor: this.prevCursor,
        };
    }

    public nextPageUrl(): string | null {
        if (!this.nextCursor) return null;
        return this.buildUrl(this.nextCursor);
    }

    public previousPageUrl(): string | null {
        if (!this.prevCursor) return null;
        return this.buildUrl(this.prevCursor);
    }

    private buildUrl(cursor: string): string {
        try {
            const store = httpContextStorage.getStore();
            if (!store) return `?cursor=${encodeURIComponent(cursor)}`;

            const req = store.request as any;
            const rawUrl = req.raw?.url ?? req.url ?? '';
            const baseUrl = rawUrl.split('?')[0];

            const currentQuery = rawUrl.split('?')[1] || '';
            const params = new URLSearchParams(currentQuery);
            params.set('cursor', cursor);
            return `${baseUrl}?${params.toString()}`;
        } catch {
            return `?cursor=${encodeURIComponent(cursor)}`;
        }
    }

    public links(styleOrView: string = 'tailwind'): string {
        const nextUrl = this.nextPageUrl();
        const prevUrl = this.previousPageUrl();

        if (!nextUrl && !prevUrl) return '';

        if (styleOrView === 'bootstrap') {
            return `
            <ul class="pagination">
                <li class="page-item ${!prevUrl ? 'disabled' : ''}">
                    <a class="page-link" href="${prevUrl || '#'}">&laquo; Previous</a>
                </li>
                <li class="page-item ${!nextUrl ? 'disabled' : ''}">
                    <a class="page-link" href="${nextUrl || '#'}">Next &raquo;</a>
                </li>
            </ul>`;
        }

        // Default Tailwind
        return `
        <nav class="flex items-center justify-between">
            <a href="${prevUrl || '#'}" class="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 ${!prevUrl ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}">
                Previous
            </a>
            <a href="${nextUrl || '#'}" class="relative inline-flex items-center px-4 py-2 ml-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 ${!nextUrl ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}">
                Next
            </a>
        </nav>`;
    }
}

export class QueryBuilder<T extends BaseModel = any> {
    private query!: Knex.QueryBuilder;
    private modelClass: new (attrs?: Record<string, any>) => T;
    private primaryKey: string;
    private eagerRelations: string[] = [];

    // Dual-engine driver identifier: "sql" or "mongodb"
    private driver: "sql" | "mongodb" = "sql";

    // Mongo-specific query state
    private mongoFilter: Record<string, any> = {};
    private mongoSort: Record<string, 1 | -1> = {};
    private mongoLimit: number = 0;
    private mongoSkip: number = 0;

    // Global scopes applied from the model — keyed by scope name for easy removal
    private appliedGlobalScopes: Map<string, GlobalScopeCallback<T>> = new Map();

    // Tracks which global scope names have been explicitly removed via withoutGlobalScope()
    private removedGlobalScopes: Set<string> = new Set();

    constructor(modelClass: new (attrs?: Record<string, any>) => T, knexQuery?: Knex.QueryBuilder, primaryKey = "id", driver: "sql" | "mongodb" = "sql") {
        this.modelClass = modelClass;
        this.primaryKey = primaryKey;
        this.driver = driver;
        if (knexQuery) {
            this.query = knexQuery;
        }
    }

    /**
     * Register a global scope callback onto this builder (called by BaseModel.query())
     * @internal
     */
    public addGlobalScope(name: string, callback: GlobalScopeCallback<T>): this {
        this.appliedGlobalScopes.set(name, callback);
        return this;
    }

    /**
     * Apply all registered global scopes that have not been removed.
     * Called lazily before the first query execution.
     * @internal
     */
    private applyGlobalScopes(): void {
        for (const [name, callback] of this.appliedGlobalScopes) {
            if (!this.removedGlobalScopes.has(name)) {
                callback(this);
            }
        }
        // Clear after applying so they are not re-applied on chained calls
        this.appliedGlobalScopes.clear();
    }

    /**
     * Exclude a specific global scope from being applied to this query.
     * Usage: User.query().withoutGlobalScope('active').get()
     */
    public withoutGlobalScope(name: string): this {
        this.removedGlobalScopes.add(name);
        return this;
    }

    /**
     * Exclude multiple (or all) global scopes from being applied to this query.
     * Pass scope names to remove specific ones, or call with no args to remove all.
     * Usage: User.query().withoutGlobalScopes().get()
     *        User.query().withoutGlobalScopes('active', 'published').get()
     */
    public withoutGlobalScopes(...names: string[]): this {
        if (names.length === 0) {
            // Remove all — mark every registered scope name as removed
            for (const name of this.appliedGlobalScopes.keys()) {
                this.removedGlobalScopes.add(name);
            }
        } else {
            for (const name of names) {
                this.removedGlobalScopes.add(name);
            }
        }
        return this;
    }

    /**
     * Apply a named local scope defined on the model class.
     * Local scopes are methods prefixed with "scope" (e.g. scopeActive() -> .scope('active')).
     * Supports passing arguments to parameterised scopes.
     *
     * Usage:
     *   // Model: scopeActive(builder) { builder.where('status', 'active') }
     *   User.query().scope('active').get()
     *
     *   // Model: scopeOfType(builder, type) { builder.where('type', type) }
     *   User.query().scope('ofType', 'admin').get()
     */
    public scope(name: string, ...args: any[]): this {
        const methodName = `scope${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        const dummyInstance = new this.modelClass() as any;

        if (typeof dummyInstance[methodName] !== "function") {
            throw new Error(`[StruxJS ORM Error]: Local scope '${name}' (method '${methodName}') is not defined on model ${this.modelClass.name}.`);
        }

        dummyInstance[methodName](this, ...args);
        return this;
    }

    /**
     * Bind query execution to a database transaction
     */
    public transacting(trx: any): this {
        if (this.driver === "sql" && trx) {
            this.query.transacting(trx);
        }
        return this;
    }

    /**
     * Eager load relationship models (e.g. .with('posts', 'profile'))
     */
    public with(...relations: string[]): this {
        const list = relations.length === 1 && Array.isArray(relations[0]) ? relations[0] : relations;
        this.eagerRelations = Array.from(new Set(this.eagerRelations.concat(list)));
        return this;
    }

    /**
     * Eager load count of relationship models (e.g. .withCount('posts'))
     */
    public withCount(...relations: string[]): this {
        const list = relations.length === 1 && Array.isArray(relations[0]) ? relations[0] : relations;

        if (this.driver === "sql") {
            const dummy = new this.modelClass();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;

            const knexBuilder = this.query as any;
            const currentSelects = knexBuilder._statements?.filter((s: any) => s.grouping === 'columns');
            if (!currentSelects || currentSelects.length === 0) {
                this.query.select(`${tableName}.*`);
            }
        }

        list.forEach(relationName => {
            if (this.driver === "sql") {
                const subQuery = this.buildRelationSubQuery(relationName);
                subQuery.clearSelect().count({ total: "*" });
                this.query.select((this.query as any).client.raw(`(${subQuery.toString()}) as ${relationName}_count`));
            }
        });

        return this;
    }

    /**
     * Eager load sum of relationship models (e.g. .withSum('posts', 'views'))
     */
    public withSum(relationName: string, column: string): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName);
            subQuery.clearSelect().sum({ total: column });
            this.query.select((this.query as any).client.raw(`(${subQuery.toString()}) as ${relationName}_sum_${column}`));
        }
        return this;
    }

    /**
     * Eager load average of relationship models (e.g. .withAvg('posts', 'rating'))
     */
    public withAvg(relationName: string, column: string): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName);
            subQuery.clearSelect().avg({ total: column });
            this.query.select((this.query as any).client.raw(`(${subQuery.toString()}) as ${relationName}_avg_${column}`));
        }
        return this;
    }

    /**
     * Eager load minimum of relationship models (e.g. .withMin('posts', 'views'))
     */
    public withMin(relationName: string, column: string): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName);
            subQuery.clearSelect().min({ total: column });
            this.query.select((this.query as any).client.raw(`(${subQuery.toString()}) as ${relationName}_min_${column}`));
        }
        return this;
    }

    /**
     * Eager load maximum of relationship models (e.g. .withMax('posts', 'views'))
     */
    public withMax(relationName: string, column: string): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName);
            subQuery.clearSelect().max({ total: column });
            this.query.select((this.query as any).client.raw(`(${subQuery.toString()}) as ${relationName}_max_${column}`));
        }
        return this;
    }

    /**
     * Filter models where relationship exists (e.g. .has('posts'))
     */
    public has(relationName: string): this {
        return this.whereHas(relationName);
    }

    /**
     * Filter models where relationship does NOT exist (e.g. .doesntHave('posts'))
     */
    public doesntHave(relationName: string): this {
        return this.whereDoesntHave(relationName);
    }

    /**
     * Filter models where relationship exists matching conditions
     */
    public whereHas(relationName: string, callback?: (query: QueryBuilder) => void): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName, callback);
            this.query.whereExists(subQuery);
        }
        return this;
    }

    /**
     * OR Filter models where relationship exists matching conditions
     */
    public orWhereHas(relationName: string, callback?: (query: QueryBuilder) => void): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName, callback);
            this.query.orWhereExists(subQuery);
        }
        return this;
    }

    /**
     * Filter models where relationship does NOT exist matching conditions
     */
    public whereDoesntHave(relationName: string, callback?: (query: QueryBuilder) => void): this {
        if (this.driver === "sql") {
            const subQuery = this.buildRelationSubQuery(relationName, callback);
            this.query.whereNotExists(subQuery);
        }
        return this;
    }

    /**
     * Filter models where relationship matches column condition (Shorthand for whereHas)
     * e.g. User.whereRelation('roles', 'slug', 'admin').get()
     */
    public whereRelation(relationName: string, column: string, operator?: any, value?: any): this {
        return this.whereHas(relationName, (q) => {
            q.where(column, operator, value);
        });
    }

    /**
     * OR Filter models where relationship matches column condition
     */
    public orWhereRelation(relationName: string, column: string, operator?: any, value?: any): this {
        return this.orWhereHas(relationName, (q) => {
            q.where(column, operator, value);
        });
    }

    /**
     * Extract array of values for a given column (or key-value map if key is passed)
     * e.g. User.pluck('email') -> ['a@b.com', 'c@d.com']
     *      User.pluck('name', 'id') -> { 1: 'Alice', 2: 'Bob' }
     */
    public async pluck(column: string, key?: string): Promise<any[] | Record<string, any>> {
        const records = await this.get();
        if (key) {
            const result: Record<string, any> = {};
            records.forEach((row: any) => {
                const k = row.attributes?.[key] ?? row[key];
                const v = row.attributes?.[column] ?? row[column];
                if (k !== undefined) result[k] = v;
            });
            return result;
        }
        return records.map((row: any) => row.attributes?.[column] ?? row[column]);
    }

    /**
     * Get single column value from first matching record
     * e.g. User.where('id', 1).value('email') -> 'alice@example.com'
     */
    public async value(column: string): Promise<any> {
        const record = await this.first();
        if (!record) return null;
        return (record as any).attributes?.[column] ?? (record as any)[column];
    }

    /**
     * Helper to construct subquery for relationship queries (whereHas, withCount)
     */
    private buildRelationSubQuery(relationName: string, callback?: (query: QueryBuilder) => void): Knex.QueryBuilder {
        const dummyModel = new this.modelClass();
        if (typeof (dummyModel as any)[relationName] !== "function") {
            throw new Error(`[StruxJS ORM Error]: Relationship '${relationName}' is not defined on model ${this.modelClass.name}.`);
        }

        const relation: Relation = (dummyModel as any)[relationName]();
        const relatedDummy = new relation.related();
        const relatedTable = (relatedDummy as any).table || `${relatedDummy.constructor.name.toLowerCase()}s`;
        const parentTable = (dummyModel as any).table || `${dummyModel.constructor.name.toLowerCase()}s`;

        const knex = BaseModel.connection();
        let subQuery: Knex.QueryBuilder;

        if (relation.relationType === "hasMany" || relation.relationType === "hasOne") {
            subQuery = knex(relatedTable).whereRaw(`${relatedTable}.${relation.foreignKey} = ${parentTable}.${relation.localKey}`);
            if (callback) {
                const nestedBuilder = new QueryBuilder(relation.related as any, subQuery, (relatedDummy as any).primaryKey, "sql");
                callback(nestedBuilder);
            }
        } else if (relation.relationType === "belongsTo") {
            subQuery = knex(relatedTable).whereRaw(`${relatedTable}.${relation.localKey} = ${parentTable}.${relation.foreignKey}`);
            if (callback) {
                const nestedBuilder = new QueryBuilder(relation.related as any, subQuery, (relatedDummy as any).primaryKey, "sql");
                callback(nestedBuilder);
            }
        } else if (relation.relationType === "belongsToMany") {
            const b2m = relation as BelongsToMany;
            subQuery = knex(b2m.pivotTable!)
                .join(relatedTable, `${relatedTable}.${b2m.relatedKey}`, "=", `${b2m.pivotTable!}.${b2m.relatedPivotKey!}`)
                .whereRaw(`${b2m.pivotTable!}.${b2m.foreignKey} = ${parentTable}.${b2m.parentKey}`);
            if (callback) {
                const nestedBuilder = new QueryBuilder(relation.related as any, subQuery, (relatedDummy as any).primaryKey, "sql");
                callback(nestedBuilder);
            }
        } else {
            throw new Error(`[StruxJS ORM Error]: Unsupported relation type '${(relation as any).relationType}'.`);
        }

        return subQuery;
    }

    /**
     * Internal method to execute batch eager loading queries on fetched models
     */
    private async eagerLoadRelations(models: T[]): Promise<void> {
        if (models.length === 0 || this.eagerRelations.length === 0) return;

        for (const relationName of this.eagerRelations) {
            const dummy = models[0] as any;
            if (typeof dummy[relationName] === "function") {
                const relation: Relation = dummy[relationName]();
                if (relation && typeof relation.getEager === "function") {
                    const results = await relation.getEager(models);
                    relation.match(models, results, relationName);
                }
            }
        }
    }

    /**
     * Get underlying raw Knex Query Builder instance
     */
    public getKnexQuery(): Knex.QueryBuilder {
        return this.query;
    }

    /**
     * Select specific columns
     */
    public select(...columns: string[]): this {
        const cols = columns.length === 1 && Array.isArray(columns[0]) ? columns[0] : columns;
        if (this.driver === "sql") {
            this.query.select(cols as any);
        }
        return this;
    }

    /**
     * Select column via subquery
     */
    public selectSub(subQuery: QueryBuilder | ((builder: Knex.QueryBuilder) => void), alias: string): this {
        if (this.driver === "sql") {
            if (subQuery instanceof QueryBuilder) {
                this.query.select(subQuery.getKnexQuery().as(alias));
            } else if (typeof subQuery === "function") {
                this.query.select(function (this: Knex.QueryBuilder) {
                    subQuery(this);
                } as any);
            }
        }
        return this;
    }

    /**
     * Select raw SQL expression
     */
    public selectRaw(sql: string, bindings: any[] = []): this {
        if (this.driver === "sql") {
            this.query.select((this.query as any).client.raw(sql, bindings));
        }
        return this;
    }

    /**
     * Add where condition or nested closure group
     */
    public where(column: string | Record<string, any> | ((builder: QueryBuilder<T>) => void) | QueryBuilder, operator?: any, value?: any): this {
        if (typeof column === "function") {
            if (this.driver === "sql") {
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const builderInstance = this;
                this.query.where(function (this: Knex.QueryBuilder) {
                    const nestedBuilder = new QueryBuilder(builderInstance.modelClass, this, builderInstance.primaryKey, "sql");
                    (column as any)(nestedBuilder);
                });
            }
        } else if (column instanceof QueryBuilder) {
            if (this.driver === "sql") {
                this.query.where(column.getKnexQuery());
            }
        } else if (typeof column === "object" && !Array.isArray(column) && column !== null) {
            if (this.driver === "sql") {
                this.query.where(column);
            } else {
                Object.assign(this.mongoFilter, column);
            }
        } else if (value !== undefined) {
            if (this.driver === "sql") {
                const targetVal = value instanceof QueryBuilder ? value.getKnexQuery() : value;
                this.query.where(column as string, operator, targetVal);
            } else {
                this.applyMongoWhere(column as string, operator, value);
            }
        } else if (operator !== undefined) {
            if (this.driver === "sql") {
                const targetVal = operator instanceof QueryBuilder ? operator.getKnexQuery() : operator;
                this.query.where(column as string, "=", targetVal);
            } else {
                this.applyMongoWhere(column as string, "=", operator);
            }
        }
        return this;
    }

    private applyMongoWhere(column: string, op: string, val: any): void {
        const key = column === "id" || column === "id" ? "_id" : column;
        const targetVal = key === "_id" ? MongoConnection.toObjectId(val) : val;

        switch (op) {
            case "=":
            case "==":
                this.mongoFilter[key] = targetVal;
                break;
            case ">":
                this.mongoFilter[key] = { ...this.mongoFilter[key], $gt: targetVal };
                break;
            case ">=":
                this.mongoFilter[key] = { ...this.mongoFilter[key], $gte: targetVal };
                break;
            case "<":
                this.mongoFilter[key] = { ...this.mongoFilter[key], $lt: targetVal };
                break;
            case "<=":
                this.mongoFilter[key] = { ...this.mongoFilter[key], $lte: targetVal };
                break;
            case "!=":
            case "<>":
                this.mongoFilter[key] = { ...this.mongoFilter[key], $ne: targetVal };
                break;
            case "like":
            case "LIKE":
                const cleanStr = String(val).replace(/%/g, "");
                this.mongoFilter[key] = new RegExp(cleanStr, "i");
                break;
            default:
                this.mongoFilter[key] = targetVal;
                break;
        }
    }

    /**
     * Add OR WHERE condition
     */
    public orWhere(column: string | Record<string, any> | ((builder: QueryBuilder<T>) => void) | QueryBuilder, operator?: any, value?: any): this {
        return this.where(column as any, operator, value);
    }

    /**
     * Apply conditional query clause if value is truthy
     */
    public when(value: any, callback: (builder: this, value: any) => void, defaultCallback?: (builder: this, value: any) => void): this {
        if (value) {
            callback(this, value);
        } else if (defaultCallback) {
            defaultCallback(this, value);
        }
        return this;
    }

    /**
     * Apply conditional query clause if value is falsy
     */
    public unless(value: any, callback: (builder: this, value: any) => void, defaultCallback?: (builder: this, value: any) => void): this {
        if (!value) {
            callback(this, value);
        } else if (defaultCallback) {
            defaultCallback(this, value);
        }
        return this;
    }

    /**
     * WHERE IN condition
     */
    public whereIn(column: string, values: any[] | QueryBuilder | ((builder: Knex.QueryBuilder) => void)): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            if (values instanceof QueryBuilder) {
                this.query.whereIn(column, values.getKnexQuery());
            } else if (typeof values === "function") {
                this.query.whereIn(column, values as any);
            } else {
                this.query.whereIn(column, values);
            }
        } else if (Array.isArray(values)) {
            const cleanVals = key === "_id" ? values.map(MongoConnection.toObjectId) : values;
            this.mongoFilter[key] = { $in: cleanVals };
        }
        return this;
    }

    /**
     * WHERE NOT IN condition
     */
    public whereNotIn(column: string, values: any[] | QueryBuilder | ((builder: Knex.QueryBuilder) => void)): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            if (values instanceof QueryBuilder) {
                this.query.whereNotIn(column, values.getKnexQuery());
            } else if (typeof values === "function") {
                this.query.whereNotIn(column, values as any);
            } else {
                this.query.whereNotIn(column, values);
            }
        } else if (Array.isArray(values)) {
            const cleanVals = key === "_id" ? values.map(MongoConnection.toObjectId) : values;
            this.mongoFilter[key] = { $nin: cleanVals };
        }
        return this;
    }

    /**
     * WHERE EXISTS subquery condition
     */
    public whereExists(callback: QueryBuilder | ((builder: Knex.QueryBuilder) => void)): this {
        if (this.driver === "sql") {
            if (callback instanceof QueryBuilder) {
                this.query.whereExists(callback.getKnexQuery());
            } else {
                this.query.whereExists(callback);
            }
        }
        return this;
    }

    /**
     * WHERE NOT EXISTS subquery condition
     */
    public whereNotExists(callback: QueryBuilder | ((builder: Knex.QueryBuilder) => void)): this {
        if (this.driver === "sql") {
            if (callback instanceof QueryBuilder) {
                this.query.whereNotExists(callback.getKnexQuery());
            } else {
                this.query.whereNotExists(callback);
            }
        }
        return this;
    }

    /**
     * WHERE RAW condition
     */
    public whereRaw(sql: string, bindings: any[] = []): this {
        if (this.driver === "sql") {
            this.query.whereRaw(sql, bindings);
        }
        return this;
    }

    /**
     * OR WHERE RAW condition
     */
    public orWhereRaw(sql: string, bindings: any[] = []): this {
        if (this.driver === "sql") {
            this.query.orWhereRaw(sql, bindings);
        }
        return this;
    }

    /**
     * ORDER BY RAW condition
     */
    public orderByRaw(sql: string, bindings: any[] = []): this {
        if (this.driver === "sql") {
            this.query.orderByRaw(sql, bindings);
        }
        return this;
    }

    /**
     * HAVING RAW condition
     */
    public havingRaw(sql: string, bindings: any[] = []): this {
        if (this.driver === "sql") {
            this.query.havingRaw(sql, bindings);
        }
        return this;
    }

    /**
     * Group query results by columns
     */
    public groupBy(...columns: string[]): this {
        const cols = columns.length === 1 && Array.isArray(columns[0]) ? columns[0] : columns;
        if (this.driver === "sql") {
            this.query.groupBy(cols as any);
        }
        return this;
    }

    /**
     * Filter grouped results via HAVING clause
     */
    public having(column: string, operator?: any, value?: any): this {
        if (this.driver === "sql") {
            if (value !== undefined) {
                this.query.having(column, operator, value);
            } else if (operator !== undefined) {
                this.query.having(column, "=", operator);
            }
        }
        return this;
    }

    /**
     * Filter grouped results via OR HAVING clause
     */
    public orHaving(column: string, operator?: any, value?: any): this {
        if (this.driver === "sql") {
            if (value !== undefined) {
                this.query.orHaving(column, operator, value);
            } else if (operator !== undefined) {
                this.query.orHaving(column, "=", operator);
            }
        }
        return this;
    }

    /**
     * FROM SUBQUERY
     */
    public fromSub(subQuery: QueryBuilder | ((builder: Knex.QueryBuilder) => void), alias: string): this {
        if (this.driver === "sql") {
            if (subQuery instanceof QueryBuilder) {
                this.query.from(subQuery.getKnexQuery().as(alias));
            } else if (typeof subQuery === "function") {
                this.query.from(subQuery as any).as(alias);
            }
        }
        return this;
    }

    /**
     * WHERE NULL condition
     */
    public whereNull(column: string): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            this.query.whereNull(column);
        } else {
            this.mongoFilter[key] = null;
        }
        return this;
    }

    /**
     * WHERE NOT NULL condition
     */
    public whereNotNull(column: string): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            this.query.whereNotNull(column);
        } else {
            this.mongoFilter[key] = { $ne: null };
        }
        return this;
    }

    /**
     * WHERE BETWEEN condition
     */
    public whereBetween(column: string, range: [any, any]): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            this.query.whereBetween(column, range);
        } else {
            this.mongoFilter[key] = { $gte: range[0], $lte: range[1] };
        }
        return this;
    }

    /**
     * WHERE NOT BETWEEN condition
     */
    public whereNotBetween(column: string, range: [any, any]): this {
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            this.query.whereNotBetween(column, range);
        } else {
            this.mongoFilter[key] = { $not: { $gte: range[0], $lte: range[1] } };
        }
        return this;
    }

    /**
     * Compare two database columns
     */
    public whereColumn(first: string, operatorOrSecond: string, second?: string): this {
        if (this.driver === "sql") {
            const knex = (this.query as any).client;
            if (second !== undefined) {
                this.query.where(first, operatorOrSecond, knex.ref(second));
            } else {
                this.query.where(first, "=", knex.ref(operatorOrSecond));
            }
        }
        return this;
    }

    /**
     * Order results by column and direction
     */
    public orderBy(column: string, direction: "asc" | "desc" | "ASC" | "DESC" = "asc"): this {
        const dirNum: 1 | -1 = direction.toLowerCase() === "desc" ? -1 : 1;
        const key = column === "id" ? "_id" : column;
        if (this.driver === "sql") {
            this.query.orderBy(column, direction.toLowerCase() as any);
        } else {
            this.mongoSort[key] = dirNum;
        }
        return this;
    }

    /**
     * Order by newest created records
     */
    public latest(column = "created_at"): this {
        return this.orderBy(column, "desc");
    }

    /**
     * Order by oldest created records
     */
    public oldest(column = "created_at"): this {
        return this.orderBy(column, "asc");
    }

    /**
     * Limit maximum rows returned
     */
    public limit(count: number): this {
        if (this.driver === "sql") {
            this.query.limit(count);
        } else {
            this.mongoLimit = count;
        }
        return this;
    }

    /**
     * Alias for limit()
     */
    public take(count: number): this {
        return this.limit(count);
    }

    /**
     * Offset query results
     */
    public offset(count: number): this {
        if (this.driver === "sql") {
            this.query.offset(count);
        } else {
            this.mongoSkip = count;
        }
        return this;
    }

    /**
     * Alias for offset()
     */
    public skip(count: number): this {
        return this.offset(count);
    }

    /**
     * Execute query and return results wrapped inside a Collection (collect.js)
     */
    public async get(): Promise<Collection<T>> {
        this.applyGlobalScopes();
        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const dummy = new this.modelClass();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;

            let cursor = db.collection(tableName).find(this.mongoFilter);
            if (Object.keys(this.mongoSort).length > 0) cursor = cursor.sort(this.mongoSort);
            if (this.mongoSkip > 0) cursor = cursor.skip(this.mongoSkip);
            if (this.mongoLimit > 0) cursor = cursor.limit(this.mongoLimit);

            const rows = await cursor.toArray();
            const models = rows.map((row: any) => {
                if (row._id) {
                    row.id = String(row._id);
                }
                return new this.modelClass(row);
            });
            await this.eagerLoadRelations(models);
            return collect(models);
        }

        const rows = await this.query;
        const models = rows.map((row: any) => new this.modelClass(row));
        await this.eagerLoadRelations(models);
        return collect(models);
    }

    /**
     * Alias for get()
     */
    public async all(): Promise<Collection<T>> {
        return this.get();
    }

    /**
     * Get first matching Model instance or null
     */
    public async first(): Promise<T | null> {
        this.applyGlobalScopes();
        if (this.driver === "mongodb") {
            const collection = await this.limit(1).get();
            return collection.first() || null;
        }

        const row = await this.query.first();
        if (!row) return null;
        const model = new this.modelClass(row);
        await this.eagerLoadRelations([model]);
        return model;
    }

    /**
     * Get first matching Model instance or throw error
     */
    public async firstOrFail(): Promise<T> {
        const model = await this.first();
        if (!model) {
            const err: any = new Error(`[StruxJS ORM Error]: Model record not found.`);
            err.statusCode = 404;
            err.status = 404;
            throw err;
        }
        return model;
    }

    /**
     * Find model by primary key ID
     */
    public async find(id: any): Promise<T | null> {
        return await this.where(this.primaryKey, id).first();
    }

    /**
     * Find model by primary key ID or throw error
     */
    public async findOrFail(id: any): Promise<T> {
        const model = await this.find(id);
        if (!model) {
            const err: any = new Error(`[StruxJS ORM Error]: Model record with primary key '${id}' not found.`);
            err.statusCode = 404;
            err.status = 404;
            throw err;
        }
        return model;
    }

    /**
     * Execute query and return single matching record. Throws 404 if 0 records or 500 if >1 records.
     */
    public async sole(): Promise<T> {
        const results = await this.limit(2).get();
        const items = Array.isArray(results) ? results : (results as any).all();
        if (items.length === 0) {
            const err: any = new Error("[StruxJS ORM Error]: No records found for sole().");
            err.statusCode = 404;
            err.status = 404;
            throw err;
        }
        if (items.length > 1) {
            const err: any = new Error("[StruxJS ORM Error]: Multiple records found when expecting sole record.");
            err.statusCode = 500;
            throw err;
        }
        return items[0];
    }

    /**
     * Alias for sole()
     */
    public async soleOrFail(): Promise<T> {
        return await this.sole();
    }

    /**
     * Find multiple models by array of primary key IDs or throw 404 error if any ID is missing
     */
    public async findManyOrFail(ids: any[]): Promise<Collection<T>> {
        const results = await this.whereIn(this.primaryKey, ids).get();
        const items = Array.isArray(results) ? results : (results as any).all();
        if (items.length !== ids.length) {
            const err: any = new Error("[StruxJS ORM Error]: One or more primary keys not found in findManyOrFail.");
            err.statusCode = 404;
            err.status = 404;
            throw err;
        }
        return results;
    }

    /**
     * Get first matching row or create new record with merged attributes
     */
    public async firstOrCreate(attributes: Record<string, any>, values: Record<string, any> = {}): Promise<T> {
        const instance = await this.where(attributes).first();
        if (instance) return instance;

        const merged = { ...attributes, ...values };
        return await (this.modelClass as any).create(merged);
    }

    /**
     * Update existing matching record or create new record
     */
    public async updateOrCreate(attributes: Record<string, any>, values: Record<string, any>): Promise<T> {
        let instance = await this.where(attributes).first();
        if (instance) {
            Object.assign((instance as any).attributes, values);
            await (instance as any).save();
            return instance;
        }
        return await (this.modelClass as any).create({ ...attributes, ...values });
    }

    /**
     * Count matching rows
     */
    public async count(column = "*"): Promise<number> {
        this.applyGlobalScopes();
        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const dummy = new this.modelClass();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;
            return await db.collection(tableName).countDocuments(this.mongoFilter);
        }

        const res = await this.query.count({ total: column }).first();
        return res ? Number(res.total) : 0;
    }

    /**
     * Get max value of column
     */
    public async max(column: string): Promise<any> {
        if (this.driver === "mongodb") {
            const res = await this.orderBy(column, "desc").first();
            return res ? (res as any)[column] : null;
        }
        const res = await this.query.max({ val: column }).first();
        return res ? res.val : null;
    }

    /**
     * Get min value of column
     */
    public async min(column: string): Promise<any> {
        if (this.driver === "mongodb") {
            const res = await this.orderBy(column, "asc").first();
            return res ? (res as any)[column] : null;
        }
        const res = await this.query.min({ val: column }).first();
        return res ? res.val : null;
    }

    /**
     * Get average value of column
     */
    public async avg(column: string): Promise<number> {
        const items = await this.get();
        if (items.count() === 0) return 0;
        const res = items.avg(column as any);
        return typeof res === "number" ? res : Number(res || 0);
    }

    /**
     * Get sum of column
     */
    public async sum(column: string): Promise<number> {
        const items = await this.get();
        const res = items.sum(column as any);
        return typeof res === "number" ? res : Number(res || 0);
    }

    /**
     * Check if matching rows exist
     */
    public async exists(): Promise<boolean> {
        const total = await this.count();
        return total > 0;
    }

    /**
     * Check if matching rows do NOT exist
     */
    public async doesntExist(): Promise<boolean> {
        return !(await this.exists());
    }

    /**
     * Paginate query results Strux-style with Collection data
     */
    public async paginate(perPage = 15, page = 1): Promise<PaginationResult<T>> {
        const pageNum = Math.max(1, page);
        const limitNum = Math.max(1, perPage);

        // Clone query for count — avoid mutating the original builder
        const countBuilder = this.query.clone().clearOrder().clearSelect().count("* as total");
        const countResult = await countBuilder;
        const total = Number(
            Array.isArray(countResult)
                ? (countResult[0]?.total ?? countResult[0]?.["count(* as total)"] ?? countResult[0]?.["count(*)"] ?? 0)
                : 0
        );

        const offsetNum = (pageNum - 1) * limitNum;

        // Clone query for data fetch — preserve original filters/joins
        const dataQuery = this.query.clone().limit(limitNum).offset(offsetNum);
        const rows = await dataQuery;
        const models = Array.isArray(rows)
            ? rows.map((row: any) => new this.modelClass(row))
            : [];

        await this.eagerLoadRelations(models);

        return new PaginationResult(collect(models), total, limitNum, pageNum);
    }

    /**
     * Chunk the results of the query.
     */
    public async chunk(count: number, callback: (models: Collection<T>, page: number) => boolean | void | Promise<boolean | void>): Promise<void> {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const offsetNum = (page - 1) * count;
            const dataQuery = this.query.clone().limit(count).offset(offsetNum);
            const rows = await dataQuery;
            const modelsArray = Array.isArray(rows) ? rows.map((row: any) => new this.modelClass(row)) : [];
            await this.eagerLoadRelations(modelsArray);
            
            const models = collect(modelsArray);

            if (models.isEmpty()) {
                hasMore = false;
                break;
            }

            const cbResult = await callback(models, page);
            
            if (cbResult === false) {
                break;
            }

            if (models.count() < count) {
                hasMore = false;
            } else {
                page++;
            }
        }
    }

    /**
     * Query lazily, by chunks of the given size.
     */
    public async *lazy(chunkSize: number = 1000): AsyncGenerator<T, void, unknown> {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const offsetNum = (page - 1) * chunkSize;
            const dataQuery = this.query.clone().limit(chunkSize).offset(offsetNum);
            const rows = await dataQuery;
            const modelsArray = Array.isArray(rows) ? rows.map((row: any) => new this.modelClass(row)) : [];
            await this.eagerLoadRelations(modelsArray);
            
            const models = collect(modelsArray);

            if (models.isEmpty()) {
                hasMore = false;
                break;
            }

            for (const model of models) {
                yield model;
            }

            if (models.count() < chunkSize) {
                hasMore = false;
            } else {
                page++;
            }
        }
    }

    /**
     * Paginate query results using a cursor.
     */
    public async cursorPaginate(perPage = 15, cursorColumn = 'id', direction: 'asc' | 'desc' = 'asc', currentCursor: string | null = null): Promise<CursorPaginationResult<T>> {
        const limitNum = Math.max(1, perPage);
        const knexQuery = this.query.clone();

        knexQuery.orderBy(cursorColumn, direction);

        let cursorValue: any = null;
        if (currentCursor) {
            try {
                const decoded = Buffer.from(currentCursor, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                cursorValue = parsed.value;
            } catch (e) {
                // Ignore invalid cursor
            }
        }

        if (cursorValue !== null) {
            const operator = direction.toLowerCase() === 'asc' ? '>' : '<';
            knexQuery.where(cursorColumn, operator, cursorValue);
        }

        const rows = await knexQuery.limit(limitNum + 1);
        const modelsArray = Array.isArray(rows) ? rows.map((row: any) => new this.modelClass(row)) : [];
        await this.eagerLoadRelations(modelsArray);

        const hasNext = modelsArray.length > limitNum;
        if (hasNext) {
            modelsArray.pop();
        }

        let nextCursor: string | null = null;
        if (hasNext && modelsArray.length > 0) {
            const lastItem = modelsArray[modelsArray.length - 1];
            const lastVal = (lastItem as any)[cursorColumn];
            if (lastVal !== undefined) {
                nextCursor = Buffer.from(JSON.stringify({ value: lastVal })).toString('base64');
            }
        }

        return new CursorPaginationResult<T>(collect(modelsArray), limitNum, nextCursor, null);
    }

    /**
     * Mass update matching rows
     */
    public async update(values: Record<string, any>): Promise<number> {
        this.applyGlobalScopes();
        
        const dummy = new this.modelClass();
        if ((dummy as any).timestamps !== false) {
            const updatedCol = (dummy as any).updatedColumn === null ? null : ((dummy as any).updatedColumn ?? (this.modelClass as any).UPDATED_AT);
            if (updatedCol && !values[updatedCol]) {
                values[updatedCol] = new Date();
            }
        }

        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;
            const res = await db.collection(tableName).updateMany(this.mongoFilter, { $set: values });
            return res.modifiedCount;
        }
        return await this.query.update(values);
    }

    /**
     * Mass delete matching rows
     */
    public async delete(): Promise<number> {
        this.applyGlobalScopes();
        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const dummy = new this.modelClass();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;
            const res = await db.collection(tableName).deleteMany(this.mongoFilter);
            return res.deletedCount;
        }
        return await this.query.delete();
    }

    /* ---------------------------------------------------------------------- */
    /*  SOFT DELETE BUILDER METHODS                                            */
    /* ---------------------------------------------------------------------- */

    /**
     * Include soft-deleted (trashed) records in query results.
     * Removes the "not deleted" global scope added by softDelete = true.
     *
     * Post.withTrashed().get()
     */
    public withTrashed(): this {
        return this.withoutGlobalScope("softDelete");
    }

    /**
     * Return ONLY soft-deleted records.
     *
     * Post.onlyTrashed().get()
     */
    public onlyTrashed(): this {
        this.withoutGlobalScope("softDelete");
        const dummy = new this.modelClass() as any;
        const col = dummy.deletedAtColumn ?? "deleted_at";
        if (this.driver === "sql") {
            this.query.whereNotNull(col);
        } else {
            this.mongoFilter[col] = { $ne: null };
        }
        return this;
    }

    /**
     * Restore soft-deleted records matching the current query constraints.
     * Sets deleted_at back to NULL for all matched rows.
     *
     * await Post.onlyTrashed().where('user_id', 1).restore()
     */
    public async restore(): Promise<number> {
        // Must include trashed rows to be able to restore them
        this.withoutGlobalScope("softDelete");
        this.applyGlobalScopes();

        const dummy = new this.modelClass() as any;
        const col = dummy.deletedAtColumn ?? "deleted_at";

        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const tableName = dummy.table || `${dummy.constructor.name.toLowerCase()}s`;
            const res = await db.collection(tableName).updateMany(
                { ...this.mongoFilter, [col]: { $ne: null } },
                { $set: { [col]: null } }
            );
            return res.modifiedCount;
        }

        return await this.query.whereNotNull(col).update({ [col]: null });
    }

    /**
     * Permanently delete records matching the current query (bypasses soft delete).
     *
     * await Post.onlyTrashed().forceDelete()
     * await Post.withTrashed().where('id', 5).forceDelete()
     */
    public async forceDelete(): Promise<number> {
        this.withoutGlobalScope("softDelete");
        this.applyGlobalScopes();

        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const dummy = new this.modelClass();
            const tableName = (dummy as any).table || `${dummy.constructor.name.toLowerCase()}s`;
            const res = await db.collection(tableName).deleteMany(this.mongoFilter);
            return res.deletedCount;
        }

        return await this.query.delete();
    }

    /**
     * Mass soft-delete matching rows (sets deleted_at = NOW).
     * Only works when the model has softDelete = true.
     *
     * await Post.where('user_id', 5).softDelete()
     */
    public async softDelete(): Promise<number> {
        this.applyGlobalScopes();

        const dummy = new this.modelClass() as any;
        const col = dummy.deletedAtColumn ?? "deleted_at";
        const now = new Date();

        if (this.driver === "mongodb") {
            const db = MongoConnection.getDb();
            const tableName = dummy.table || `${dummy.constructor.name.toLowerCase()}s`;
            const res = await db.collection(tableName).updateMany(
                this.mongoFilter,
                { $set: { [col]: now } }
            );
            return res.modifiedCount;
        }

        return await this.query.update({ [col]: now });
    }

    /**
     * Get the raw SQL string for the current query
     */
    public toSql(): string {
        return this.query.toString();
    }

    /** Dump SQL query string and bindings without halting execution */
    public dump(): this {
        dump({ sql: this.query.toString(), bindings: (this.query.toSQL() as any).bindings || [] });
        return this;
    }

    /** Dump SQL query string and bindings and halt execution */
    public dd(): any {
        return dd({ sql: this.query.toString(), bindings: (this.query.toSQL() as any).bindings || [] });
    }
}
