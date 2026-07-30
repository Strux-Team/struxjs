import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { Router } from "./Router.js";

export interface RouteOptions {
    prefix?: string;
    middlewares?: any[];
    middleware?: any[];
    withoutMiddleware?: any[];
    withoutMiddlewares?: any[];
    as?: string;
    name?: string;
}

export type RouteHandler = string | [any, string] | ((...args: any[]) => any);

interface GroupContext {
    prefix?: string;
    middlewares?: any[];
    withoutMiddleware?: any[];
    as?: string;
}

export interface RouteRecord {
    method: string;
    uri: string;
    name?: string;
    action: string;
    middlewares: string[];
}

export class RouteChain {
    constructor(
        private fullPath: string,
        private optionsNamePrefix: string,
        private record?: RouteRecord,
        private optionsRef?: RouteOptions
    ) {}

    /**
     * Name the registered route (e.g. .name('welcome') or .name('users.index'))
     */
    public name(routeName: string): this {
        const fullName = this.optionsNamePrefix ? `${this.optionsNamePrefix}${routeName}` : routeName;
        Route.registerNamedRoute(fullName, this.fullPath);
        if (this.record) {
            this.record.name = fullName;
        }
        return this;
    }

    /**
     * Attach middleware(s) to the chained route (e.g. .middleware(AuthMiddleware) or .middleware(['auth', CheckRole]))
     */
    public middleware(middlewares: any): this {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        if (this.optionsRef && this.optionsRef.middlewares) {
            for (const m of list) {
                if (!this.optionsRef.middlewares.includes(m)) {
                    this.optionsRef.middlewares.push(m);
                }
            }
        }
        if (this.record) {
            const formatted = list.map((m: any) => typeof m === "function" ? (m.name || "AnonymousMiddleware") : String(m));
            this.record.middlewares.push(...formatted);
        }
        return this;
    }

    /**
     * Alias for .middleware(...)
     */
    public middlewares(middlewares: any): this {
        return this.middleware(middlewares);
    }

    public use(middlewares: any): this {
        return this.middleware(middlewares);
    }

    /**
     * Exclude specific middleware(s) from this route (e.g. .withoutMiddleware(VerifyCsrfToken) or .withoutMiddleware('csrf'))
     */
    public withoutMiddleware(middlewares: any): this {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        if (this.optionsRef && this.optionsRef.middlewares) {
            for (let i = this.optionsRef.middlewares.length - 1; i >= 0; i--) {
                const m = this.optionsRef.middlewares[i];
                const mName = typeof m === "function" ? m.name : String(m);
                const lcMName = mName.toLowerCase();

                const shouldRemove = list.some(ex => {
                    const exName = typeof ex === "function" ? ex.name : String(ex);
                    const lcExName = exName.toLowerCase();
                    if (lcMName === lcExName) return true;
                    if (lcExName === "csrf" && (lcMName.includes("csrf") || lcMName.includes("verifycsrftoken"))) return true;
                    if (lcExName === "session" && (lcMName.includes("session") || lcMName.includes("startsession"))) return true;
                    return false;
                });

                if (shouldRemove) {
                    this.optionsRef.middlewares.splice(i, 1);
                }
            }
        }

        if (this.record) {
            this.record.middlewares = this.record.middlewares.filter(mName => {
                const lcMName = mName.toLowerCase();
                return !list.some(ex => {
                    const exName = typeof ex === "function" ? ex.name : String(ex);
                    const lcExName = exName.toLowerCase();
                    if (lcMName === lcExName) return true;
                    if (lcExName === "csrf" && (lcMName.includes("csrf") || lcMName.includes("verifycsrftoken"))) return true;
                    if (lcExName === "session" && (lcMName.includes("session") || lcMName.includes("startsession"))) return true;
                    return false;
                });
            });
        }
        return this;
    }

    public withoutMiddlewares(middlewares: any): this {
        return this.withoutMiddleware(middlewares);
    }
}

export class RouteGroupBuilder {
    private options: RouteOptions = {};

    constructor(initialOptions: RouteOptions = {}) {
        const middlewares = initialOptions.middlewares || initialOptions.middleware || [];
        const withoutMiddleware = initialOptions.withoutMiddleware || initialOptions.withoutMiddlewares || [];
        this.options = { ...initialOptions, middlewares, withoutMiddleware };
    }

    public prefix(prefix: string): this {
        this.options.prefix = prefix;
        return this;
    }

    public middleware(middlewares: any): this {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        this.options.middlewares = (this.options.middlewares || []).concat(list);
        return this;
    }

    public middlewares(middlewares: any): this {
        return this.middleware(middlewares);
    }

    public use(middlewares: any): this {
        return this.middleware(middlewares);
    }

    public withoutMiddleware(middlewares: any): this {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        this.options.withoutMiddleware = (this.options.withoutMiddleware || []).concat(list);
        return this;
    }

    public withoutMiddlewares(middlewares: any): this {
        return this.withoutMiddleware(middlewares);
    }

    public as(asPrefix: string): this {
        this.options.as = asPrefix;
        return this;
    }

    public name(namePrefix: string): this {
        return this.as(namePrefix);
    }

    public group(callback: () => void | Promise<void>): Promise<void> | void {
        return Route.group(this.options, callback);
    }
}

export class Route {
    private static routerInstance: Router;
    private static groupStack: GroupContext[] = [];
    private static namedRoutes: Map<string, string> = new Map();
    private static globalMiddlewares: any[] = [];

    /**
     * Register global middleware(s) applied automatically to all routes
     */
    public static use(...middlewares: any[]): typeof Route {
        const flatList = middlewares.flat();
        this.globalMiddlewares = Array.from(new Set(this.globalMiddlewares.concat(flatList)));
        return this;
    }

    /**
     * Internal method used by framework to link static facade to core Router instance
     */
    public static setRouter(router: Router): void {
        this.routerInstance = router;
    }

    private static registeredRoutesList: RouteRecord[] = [];

    public static getRoutes(): RouteRecord[] {
        return this.registeredRoutesList;
    }

    public static clear(): void {
        this.groupStack = [];
        this.namedRoutes.clear();
        this.globalMiddlewares = [];
        this.registeredRoutesList = [];
    }

    public static registerNamedRoute(name: string, fullPath: string): void {
        this.namedRoutes.set(name, fullPath);
    }

    public static getNamedRouteUrl(name: string): string | undefined {
        return this.namedRoutes.get(name);
    }

    public static getNamedRoutes(): Map<string, string> {
        return this.namedRoutes;
    }

    public static group(
        optionsOrCallback: RouteOptions | (() => void | Promise<void>),
        callback?: () => void | Promise<void>
    ): Promise<void> | void {
        let options: RouteOptions = {};
        let cb: () => void | Promise<void>;

        if (typeof optionsOrCallback === "function") {
            cb = optionsOrCallback;
        } else {
            options = optionsOrCallback || {};
            cb = callback!;
        }

        const middlewares = options.middlewares || options.middleware || [];
        const withoutMiddleware = options.withoutMiddleware || options.withoutMiddlewares || [];
        const asPrefix = options.as || options.name || "";
        this.groupStack.push({
            prefix: options.prefix,
            middlewares: middlewares,
            withoutMiddleware: withoutMiddleware,
            as: asPrefix
        });

        // If callback returns a Promise, handle async (must be awaited by caller)
        // If sync, push/pop stays on same tick — no leak
        let result: void | Promise<void>;
        try {
            result = cb ? cb() : undefined;
        } catch (e) {
            this.groupStack.pop();
            throw e;
        }

        if (result instanceof Promise) {
            return result.finally(() => {
                this.groupStack.pop();
            });
        }

        // Sync path — pop immediately
        this.groupStack.pop();
    }

    /**
     * Fluent prefix builder helper: Route.prefix('api').group(...)
     */
    public static prefix(prefix: string): RouteGroupBuilder {
        return new RouteGroupBuilder({ prefix });
    }

    /**
     * Fluent middleware builder helper: Route.middleware(AuthMiddleware).group(...) or Route.middleware(['auth']).group(...)
     */
    public static middleware(middlewares: any): RouteGroupBuilder {
        const middlewareList = Array.isArray(middlewares) ? middlewares : [middlewares];
        return new RouteGroupBuilder({ middlewares: middlewareList });
    }

    public static middlewares(middlewares: any): RouteGroupBuilder {
        return this.middleware(middlewares);
    }

    public static withoutMiddleware(middlewares: any): RouteGroupBuilder {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        return new RouteGroupBuilder({ withoutMiddleware: list });
    }

    public static withoutMiddlewares(middlewares: any): RouteGroupBuilder {
        return this.withoutMiddleware(middlewares);
    }

    /**
     * Fluent name prefix builder helper: Route.as('admin.').group(...)
     */
    public static as(asPrefix: string): RouteGroupBuilder {
        return new RouteGroupBuilder({ as: asPrefix });
    }

    /**
     * Fluent name prefix builder helper: Route.name('admin.').group(...)
     */
    public static name(namePrefix: string): RouteGroupBuilder {
        return new RouteGroupBuilder({ as: namePrefix });
    }

    /**
     * Automatically scan and load web.ts and api.ts (automatically prefixed with /api)
     */
    public static async loadRoutes(appRootPath?: string): Promise<void> {
        const root = appRootPath || process.cwd();
        const routesDir = path.join(root, "routes");

        if (!fs.existsSync(routesDir)) return;

        // 1. Load Web Routes (routes/web.ts or routes/web.js or dist/routes/web.js) automatically wrapped in [StartSession, VerifyCsrfToken]
        const webTs = path.join(routesDir, "web.ts");
        const webJs = path.join(routesDir, "web.js");
        const distWebJs = path.join(root, "dist", "routes", "web.js");

        const targetWeb = fs.existsSync(distWebJs) ? distWebJs : fs.existsSync(webTs) ? webTs : fs.existsSync(webJs) ? webJs : null;

        if (targetWeb) {
            const { StartSession } = await import("../session/StartSession.js");
            const { VerifyCsrfToken } = await import("../security/VerifyCsrfToken.js");

            await Route.group({ middlewares: [StartSession as any, VerifyCsrfToken as any] }, async () => {
                await import(pathToFileURL(targetWeb).href);
            });
        }

        // 2. Load API Routes (routes/api.ts or routes/api.js or dist/routes/api.js) automatically wrapped in /api prefix
        const apiTs = path.join(routesDir, "api.ts");
        const apiJs = path.join(routesDir, "api.js");
        const distApiJs = path.join(root, "dist", "routes", "api.js");

        const targetApi = fs.existsSync(distApiJs) ? distApiJs : fs.existsSync(apiTs) ? apiTs : fs.existsSync(apiJs) ? apiJs : null;

        if (targetApi) {
            await Route.group({ prefix: "/api" }, async () => {
                await import(pathToFileURL(targetApi).href);
            });
        }

        // 3. Load Event listeners (routes/events.ts or routes/events.js)
        const eventsTs = path.join(routesDir, "events.ts");
        const eventsJs = path.join(routesDir, "events.js");
        const distEventsJs = path.join(root, "dist", "routes", "events.js");

        const eventsTarget = fs.existsSync(eventsTs)     ? eventsTs
                           : fs.existsSync(eventsJs)     ? eventsJs
                           : fs.existsSync(distEventsJs) ? distEventsJs
                           : null;

        if (eventsTarget) {
            const mod = await import(pathToFileURL(eventsTarget).href);
            const registerFn = mod.default;
            if (typeof registerFn === "function") {
                registerFn();
            }
        }
    }

    /**
     * Helper to resolve the combined path, middlewares, and name prefix from the current group stack
     */
    private static resolveRouteConfig(pathStr: string, options: RouteOptions = {}): { fullPath: string; middlewares: string[]; groupNamePrefix: string } {
        let fullPath = "";
        let combinedMiddlewares: any[] = [...this.globalMiddlewares];
        let groupNamePrefix = "";

        let excludedMiddlewares: any[] = [];
        // Build path, middlewares, and name prefixes from outer to inner groups
        for (const group of this.groupStack) {
            if (group.prefix) {
                fullPath = this.combinePaths(fullPath, group.prefix);
            }
            if (group.middlewares) {
                combinedMiddlewares = combinedMiddlewares.concat(group.middlewares);
            }
            if (group.withoutMiddleware) {
                excludedMiddlewares = excludedMiddlewares.concat(group.withoutMiddleware);
            }
            if (group.as) {
                groupNamePrefix += group.as;
            }
        }

        // Add route's own path and middlewares
        fullPath = this.combinePaths(fullPath, pathStr);

        const routeMiddlewares = options.middlewares || options.middleware || [];
        combinedMiddlewares = combinedMiddlewares.concat(routeMiddlewares);

        const routeWithout = options.withoutMiddleware || options.withoutMiddlewares || [];
        excludedMiddlewares = excludedMiddlewares.concat(routeWithout);

        // Deduplicate middlewares
        let uniqueMiddlewares = Array.from(new Set(combinedMiddlewares));

        if (excludedMiddlewares.length > 0) {
            uniqueMiddlewares = uniqueMiddlewares.filter(m => {
                const mName = typeof m === "function" ? m.name : String(m);
                const lcMName = mName.toLowerCase();
                return !excludedMiddlewares.some(ex => {
                    const exName = typeof ex === "function" ? ex.name : String(ex);
                    const lcExName = exName.toLowerCase();
                    if (lcMName === lcExName) return true;
                    if (lcExName === "csrf" && (lcMName.includes("csrf") || lcMName.includes("verifycsrftoken"))) return true;
                    if (lcExName === "session" && (lcMName.includes("session") || lcMName.includes("startsession"))) return true;
                    return false;
                });
            });
        }

        return {
            fullPath: fullPath || "/",
            middlewares: uniqueMiddlewares,
            groupNamePrefix
        };
    }

    /**
     * Combine base path and route path safely without duplicating slashes or prefixes
     */
    private static combinePaths(base: string, pathStr: string): string {
        let cleanBase = base.trim().replace(/\/+$/, "");
        let cleanPath = pathStr.trim().replace(/^\/+/, "");

        const baseToken = cleanBase.replace(/^\/+/, "");
        if (cleanBase && baseToken && cleanPath.startsWith(baseToken)) {
            cleanBase = "";
        }

        if (!cleanBase && !cleanPath) return "/";
        if (!cleanBase) return `/${cleanPath}`;
        if (!cleanPath) return cleanBase;
        return `${cleanBase}/${cleanPath}`;
    }

    public static get(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("GET", pathStr, handler, options);
    }

    public static post(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("POST", pathStr, handler, options);
    }

    public static put(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("PUT", pathStr, handler, options);
    }

    public static patch(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("PATCH", pathStr, handler, options);
    }

    public static delete(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("DELETE", pathStr, handler, options);
    }

    public static options(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("OPTIONS", pathStr, handler, options);
    }

    public static head(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        return this.addRoute("HEAD", pathStr, handler, options);
    }

    public static any(pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
        let chain: RouteChain | null = null;
        methods.forEach(method => {
            chain = this.addRoute(method, pathStr, handler, options);
        });
        return chain!;
    }

    public static match(methods: string[], pathStr: string, handler: RouteHandler, options: RouteOptions = {}): RouteChain {
        let chain: RouteChain | null = null;
        methods.forEach(method => {
            chain = this.addRoute(method.toUpperCase(), pathStr, handler, options);
        });
        return chain!;
    }

    private static addRoute(method: string, pathStr: string, handler: RouteHandler, options: RouteOptions): RouteChain {
        if (!this.routerInstance) {
            throw new Error("[StruxJS Route Error]: Route engine not linked yet. Ensure Application has booted.");
        }
        const routeOptions = { ...options };
        const { fullPath, middlewares, groupNamePrefix } = this.resolveRouteConfig(pathStr, routeOptions);
        routeOptions.middlewares = middlewares;
        this.routerInstance.addRoute(method, fullPath, handler, routeOptions);

        let actionStr = "Closure";
        if (typeof handler === "string") {
            actionStr = handler;
        } else if (Array.isArray(handler)) {
            const cName = typeof handler[0] === "function" ? handler[0].name : (handler[0]?.constructor?.name || "Controller");
            actionStr = `${cName}@${handler[1]}`;
        } else if (typeof handler === "function" && handler.name && handler.name !== "action") {
            actionStr = handler.name;
        }

        const record: RouteRecord = {
            method,
            uri: fullPath,
            action: actionStr,
            middlewares: middlewares.map((m: any) => typeof m === "function" ? (m.name || "AnonymousMiddleware") : String(m)),
            name: undefined
        };
        const chain = new RouteChain(fullPath, groupNamePrefix, record, routeOptions);

        if (options.name || options.as) {
            const rawName = options.name || options.as || "";
            chain.name(rawName);
        }

        return chain;
    }
}

/**
 * Global helper function to generate a URL for a named route
 * @param name Named route key (e.g. 'welcome', 'users.show')
 * @param params Object containing URL parameters (e.g. { userId: 123 })
 * @param query Object containing query string parameters (e.g. { search: 'alex' })
 */
export function route(name: string, params: Record<string, any> = {}, query: Record<string, any> = {}): string {
    const urlPattern = Route.getNamedRouteUrl(name);
    if (!urlPattern) {
        throw new Error(`[StruxJS Route Error]: Route with name '${name}' not found.`);
    }

    let url = urlPattern;

    // Replace URL parameters (:param or {param})
    Object.keys(params).forEach(key => {
        const value = params[key];
        url = url.replace(`:${key}`, String(value)).replace(`{${key}}`, String(value));
    });

    // Append query parameters if provided
    const queryKeys = Object.keys(query);
    if (queryKeys.length > 0) {
        const queryString = queryKeys
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
            .join("&");
        url += (url.includes("?") ? "&" : "?") + queryString;
    }

    return url;
}
