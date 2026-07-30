// src/core/http/Router.ts (Core engine)
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "path";
import fs from "fs";
import { Container } from "../container/Container.js";
import { Middleware } from "./Middleware.js";
import { Resource, ResourceCollection } from "../resources/Resource.js";
import { TemplateEngine } from "../view/TemplateEngine.js";
import { httpContextStorage, decorateRequest, decorateResponse, createContextStore, wantsJsonRequest } from "./HttpContext.js";
import { UploadedFile } from "./UploadedFile.js";
import { ACTION_PARAM_TYPES_KEY } from "../container/Inject.js";
import { FormRequest } from "../validation/FormRequest.js";
import { HttpException } from "./HttpException.js";
import { RedirectResponse } from "./RedirectResponse.js";

import { Csrf } from "../security/Csrf.js";

import fastifyMultipart from "@fastify/multipart";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import fastifyCors from "@fastify/cors";
import { config, env } from "../config/Config.js";
import { Log } from "../log/Log.js";
import { Route } from "./Route.js";

interface RouteOptions {
    middlewares?: string[];
}

export class Router {
    private fastify: FastifyInstance;

    constructor(private container: Container) {
        this.fastify = Fastify({ logger: false });
        this.fastify.register(fastifyCookie as any, {
            secret: String(config("app.key", "struxjs_secret_app_key_32bytes_long"))
        });
        this.fastify.register(fastifyMultipart, {
            attachFieldsToBody: true,
            limits: { fileSize: 50 * 1024 * 1024 }
        });
        // Register WebSocket plugin at construction time so it's always
        // available before fastify.listen() — required for WebSocketServiceProvider
        this.fastify.register(fastifyWebsocket as any);
        this.fastify.register(fastifyFormbody as any);

        const corsConfig: any = config("cors", { enabled: true, origin: "*" });
        if (corsConfig.enabled !== false) {
            this.fastify.register(fastifyCors, {
                origin: corsConfig.origin,
                methods: corsConfig.methods,
                allowedHeaders: corsConfig.allowedHeaders,
                exposedHeaders: corsConfig.exposedHeaders,
                credentials: corsConfig.credentials,
                maxAge: corsConfig.maxAge,
            });
        }
        Route.setRouter(this);
    }

    /**
     * Get the underlying Fastify engine instance
     */
    public getEngine(): FastifyInstance {
        return this.fastify;
    }

    /**
     * Register a GET route
     */
    public get(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("GET", pathUrl, handler, options);
    }

    public post(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("POST", pathUrl, handler, options);
    }

    public put(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("PUT", pathUrl, handler, options);
    }

    public patch(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("PATCH", pathUrl, handler, options);
    }

    public delete(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("DELETE", pathUrl, handler, options);
    }

    public options(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("OPTIONS", pathUrl, handler, options);
    }

    public head(pathUrl: string, handler: string | ((...args: any[]) => any), options: RouteOptions = {}): void {
        this.addRoute("HEAD", pathUrl, handler, options);
    }

    public addRoute(method: string, pathUrl: string, handler: any, options: RouteOptions = {}): void {
        this.registerRoute(method.toUpperCase() as any, pathUrl, handler, options);
    }

    private async executeMiddleware(middlewareToken: any, req: FastifyRequest, rep: FastifyReply): Promise<void> {
        const decoratedReq = decorateRequest(req);
        const decoratedRep = decorateResponse(rep);

        if (typeof middlewareToken === "function") {
            const instance = this.container.make<Middleware>(middlewareToken);
            await instance.handle(decoratedReq, decoratedRep);
            return;
        }

        if (typeof middlewareToken === "object" && middlewareToken !== null && typeof middlewareToken.handle === "function") {
            await middlewareToken.handle(decoratedReq, decoratedRep);
            return;
        }

        const colonIndex = String(middlewareToken).indexOf(":");
        const token = colonIndex !== -1 ? String(middlewareToken).slice(0, colonIndex) : String(middlewareToken);
        const params: string[] = colonIndex !== -1
            ? String(middlewareToken).slice(colonIndex + 1).split(",").map(p => p.trim())
            : [];

        const instance = this.container.make<Middleware>(token);
        await instance.handle(decoratedReq, decoratedRep, ...params);
    }

    /**
     * Core routing mapper linking HTTP methods to namespaced controller syntax or closure functions.
     */
    private registeredPostRoutes: Set<string> = new Set();

    private registerRoute(method: any, pathUrl: string, handler: any, options: RouteOptions): void {
        const routeMiddlewares = options.middlewares || [];

        // PUT/PATCH/DELETE also register a POST alias for HTML form method spoofing
        // (_method=PUT etc.). Only register the POST alias once per path to avoid duplicates.
        const needsPostAlias = ["PUT", "PATCH", "DELETE"].includes(method);
        const targetMethods: string[] = [method];
        if (needsPostAlias && !this.registeredPostRoutes.has(pathUrl)) {
            targetMethods.push("POST");
            this.registeredPostRoutes.add(pathUrl);
        }

        for (const m of targetMethods) {
            this.fastify.route({
                method: m as any,
                url: pathUrl,
                onRequest: async (req: FastifyRequest, rep: FastifyReply) => {
                    const ctx = createContextStore(req, rep);
                    (req as any).__struxCtx = ctx;
                    (globalThis as any).__lastHttpCtx = ctx;
                },
                preHandler: async (req: FastifyRequest, rep: FastifyReply, _done: (...args: any[]) => void) => {
                    await httpContextStorage.run((req as any).__struxCtx, async () => {
                        try {
                            for (const middlewareToken of routeMiddlewares) {
                                if (rep.sent) break;
                                await this.executeMiddleware(middlewareToken, req, rep);
                            }
                        } catch (error: any) {
                            if (HttpException.isHttpException(error)) {
                                return this.handleHttpException(error as HttpException, req, rep);
                            }
                            throw error;
                        }
                    });
                },
                handler: async (req: FastifyRequest, rep: FastifyReply) => {
                    if (req.method.toUpperCase() === "POST" && ["PUT", "PATCH", "DELETE"].includes(method)) {
                        const body = (req.body as Record<string, any>) || {};
                        const spoofed = (body._method || req.headers["x-http-method-override"])?.toString().toUpperCase();
                        if (spoofed !== method) {
                            return;
                        }
                    }

                await httpContextStorage.run((req as any).__struxCtx, async () => {
                    req.validate = async (rules: Record<string, any>, messages?: Record<string, string>, attributes?: Record<string, string>) => {
                        const { validatePayload } = await import("./HttpContext.js");
                        const rawBody = (req.body as Record<string, any>) || {};
                        return await validatePayload(rawBody, rules, messages, attributes);
                    };
                    try {
                        if (rep.sent) return;

                        (rep as any).view = (viewName: string, data: Record<string, any> = {}) => {
                            const cleanViewName = viewName.replace(/\./g, path.sep);
                            const viewsDir = path.join(process.cwd(), "resources", "views");
                            const fullViewPath = path.join(viewsDir, `${cleanViewName}.strux`);

                            const csrfToken = Csrf.generateToken(req, rep);
                            const viewData = { csrf_token: csrfToken, _token: csrfToken, ...data };

                            const engine = new TemplateEngine();
                            const htmlResult = engine.render(fullViewPath, viewData);

                            rep.type("text/html; charset=utf-8").send(htmlResult);
                        };

                        if (typeof handler === "function") {
                            const closureResult = await handler(decorateRequest(req), decorateResponse(rep));
                            if (closureResult !== undefined && !rep.sent) {
                                await this.sendResult(closureResult, rep, req);
                            }
                            return;
                        }

                        let controllerTarget: any;
                        let methodName: string;

                        if (Array.isArray(handler)) {
                            controllerTarget = handler[0];
                            methodName = handler[1];
                        } else if (typeof handler === "string") {
                            const [cName, mName] = handler.split("@");
                            controllerTarget = cName;
                            methodName = mName;
                        } else {
                            rep.status(500).send({
                                error: "[StruxJS Router Error]: Invalid route handler definition."
                            });
                            return;
                        }

                        let controllerInstance: any;
                        if (typeof controllerTarget === "function") {
                            controllerInstance = this.container.make(controllerTarget);
                        } else if (typeof controllerTarget === "object" && controllerTarget !== null) {
                            controllerInstance = controllerTarget;
                        } else {
                            controllerInstance = this.container.make(controllerTarget);
                        }

                        if (!controllerInstance || typeof controllerInstance[methodName] !== "function") {
                            rep.status(500).send({
                                error: `[StruxJS Router Error]: Method '${methodName}' not found on Controller '${typeof controllerTarget === "function" ? controllerTarget.name : controllerTarget}'.`
                            });
                            return;
                        }

                        const targetMethod = controllerInstance[methodName];

                        // 4. TWO-LAYER ANTI-COMPILER HYBRID INJECTION ENGINE
                        const actionParams: any[] = Reflect.getMetadata(ACTION_PARAM_TYPES_KEY, targetMethod) || [];

                        const methodStr = targetMethod.toString();
                        const paramMatch = methodStr.match(/^[^(]*\(([^)]*)\)/) || methodStr.match(/^\s*async\s+[^(]*\(([^)]*)\)/);
                        let paramNames: string[] = [];

                        if (paramMatch && paramMatch[1]) {
                            const rawParamsStr = paramMatch[1].trim();
                            if (rawParamsStr !== "") {
                                paramNames = rawParamsStr.split(",").map((param: string) => {
                                    const parts = param.split(":");
                                    const rawVarName = parts[0];
                                    return rawVarName.replace(/[\r\n\t\s]/g, "");
                                });
                            }
                        }



                        const maxParams = Math.max(actionParams.length, paramNames.length);
                        const resolvedActionParams: any[] = [];
                        const urlParams = (req.params as Record<string, string>) || {};

                        for (let index = 0; index < maxParams; index++) {
                            const paramType = actionParams[index];
                            let paramName = paramNames[index] ? paramNames[index].toLowerCase() : "";

                            // PROTECT AGAINST TSX OBFUSCATION: Normalizes 'request2' back to 'request'
                            if (paramName.includes("request")) {
                                paramName = "request";
                            }

                            let injected = false;

                            // LAYER 1: PRIORITIZE VALID METADATA CLASS TYPES
                            if (paramType && typeof paramType === "function") {
                                if (paramType.prototype instanceof FormRequest) {
                                    const formRequestInstance = new (paramType as any)();
                                    await formRequestInstance.boot(req);
                                    resolvedActionParams.push(formRequestInstance);
                                    injected = true;
                                } else if (paramType !== Object && paramType !== String && paramType !== Number && paramType !== Boolean) {
                                    resolvedActionParams.push(this.container.make(paramType));
                                    injected = true;
                                } else if (paramType.name === "FastifyRequest") {
                                    resolvedActionParams.push(decorateRequest(req));
                                    injected = true;
                                } else if (paramType.name === "FastifyReply") {
                                    resolvedActionParams.push(decorateResponse(rep));
                                    injected = true;
                                }
                            }

                            // LAYER 2: FALLBACK TO DYNAMIC CONTAINER SCANNER
                            if (!injected) {
                                if (paramName.includes("reply") || paramName.includes("response") || paramName === "rep" || paramName === "res") {
                                    resolvedActionParams.push(decorateResponse(rep));
                                }
                                else if (paramName.includes("request") || paramName === "req") {
                                    try {
                                        let targetRequestClass: any = null;
                                        const registeredKeys = Array.from((this.container as any).bindings.keys());

                                        const rawParamName = paramNames[index] ? paramNames[index].toLowerCase() : "";
                                        const cleanParamName = rawParamName.replace(/\d+$/, "");
                                        const baseParamName = cleanParamName.replace("request", "");

                                        // Match FormRequest if parameter name specifies or includes the request name (e.g. registerRequest, register, loginRequest)
                                        for (const key of registeredKeys) {
                                            if (typeof key === "function" && key.prototype instanceof FormRequest) {
                                                const className = key.name.toLowerCase();
                                                const baseClassName = className.replace("request", "");

                                                if (
                                                    cleanParamName === className ||
                                                    cleanParamName + "request" === className ||
                                                    (baseParamName !== "" && className.includes(baseParamName)) ||
                                                    (baseClassName !== "" && cleanParamName.includes(baseClassName))
                                                ) {
                                                    targetRequestClass = key;
                                                    break;
                                                }
                                            }
                                        }

                                        if (targetRequestClass) {
                                            const formRequestInstance = new targetRequestClass();
                                            await formRequestInstance.boot(req);
                                            resolvedActionParams.push(formRequestInstance);
                                        } else {
                                            // Inject standard decorated Request when generic 'request' or 'req' is used
                                            resolvedActionParams.push(decorateRequest(req));
                                        }
                                    } catch (e: any) {
                                        throw e;
                                    }
                                }
                                else if (paramName === "body") {
                                    resolvedActionParams.push(req.body || {});
                                }
                                else {
                                    // 1. Prioritize IoC Container Services resolution
                                    const registeredKeys = Array.from((this.container as any).bindings.keys());
                                    let matchingServiceKey: any = null;

                                    const rawParamName = paramNames[index] ? paramNames[index].toLowerCase() : "";
                                    const cleanParamName = rawParamName.replace(/\d+$/, "");

                                    for (const key of registeredKeys) {
                                        let keyStr = "";
                                        if (typeof key === "string") {
                                            keyStr = key.toLowerCase();
                                        } else if (typeof key === "function") {
                                            keyStr = key.name.toLowerCase();
                                        }

                                        if (keyStr !== "" && (keyStr === cleanParamName || keyStr === cleanParamName + "service")) {
                                            matchingServiceKey = key;
                                            break;
                                        }
                                    }

                                    if (matchingServiceKey) {
                                        resolvedActionParams.push(this.container.make(matchingServiceKey));
                                    }
                                    // 2. Exact or case-insensitive route parameters check
                                    else {
                                        const urlParamKeys = Object.keys(urlParams);
                                        const matchedUrlKey = urlParamKeys.find(k => k.toLowerCase() === cleanParamName);

                                        if (matchedUrlKey !== undefined) {
                                            resolvedActionParams.push(urlParams[matchedUrlKey]);
                                        }
                                        // 3. Fallback for positional URL parameters
                                        else if (urlParamKeys.length > 0) {
                                            const unusedUrlKey = urlParamKeys[index] || urlParamKeys[0];
                                            resolvedActionParams.push(urlParams[unusedUrlKey]);
                                        }
                                        else {
                                            resolvedActionParams.push(req);
                                        }
                                    }
                                }
                            }
                        }



                        // 5. Synchronously await execution to catch validation exceptions properly
                        const result = await targetMethod.apply(controllerInstance, resolvedActionParams);

                        if (result !== undefined && !rep.sent) {
                            await this.sendResult(result, rep, req);
                        }

                    } catch (error: any) {
                        if (rep.sent) return;

                        // HttpException — user-thrown abort(), dd() or explicit HTTP errors
                        if (HttpException.isHttpException(error)) {
                            return this.handleHttpException(error as HttpException, req, rep);
                        }

                        // 422 VALIDATION ERROR MASTER CATCH
                        if (error && (error.isStruxValidationError === true || error.name === "ValidationError" || error.message === "The given data was invalid.")) {
                            const reqDecorated = decorateRequest(req);

                            // Detect if API or Web Request
                            const wantsJson = wantsJsonRequest(req);

                            if (wantsJson) {
                                if (!rep.sent) {
                                    rep.status(422).send({
                                        message: error.message || "The given data was invalid.",
                                        errors: error.errors || {}
                                    });
                                }
                                return;
                            }

                            // WEB REQUEST: Save errors & old input to Session, then redirect back to previous page
                            const sessionStore = reqDecorated.session();
                            sessionStore.flash("errors", error.errors || {});

                            // Flash old input (excluding sensitive fields like password and _token)
                            const rawAll = reqDecorated.all();
                            const oldInput: Record<string, any> = {};
                            for (const [k, v] of Object.entries(rawAll)) {
                                if (k !== "password" && k !== "password_confirmation" && k !== "_token") {
                                    oldInput[k] = v;
                                }
                            }
                            sessionStore.flash("old", oldInput);
                            await sessionStore.save();

                            const referer = (req.headers.referer || req.headers.referrer) as string;
                            if (!rep.sent) {
                                rep.redirect(referer || "/");
                            }
                            return;
                        }

                        // Fallback 500 Infrastructure runtime crash channel
                        if (!rep.sent) {
                            Log.error(error, { url: req.url, method: req.method, handler: typeof handler === "string" ? handler : "Closure" });

                            const isDebug = config("app.debug") ?? env("APP_DEBUG", true);
                            if (isDebug) {
                                const wantsJson = wantsJsonRequest(req);

                                if (wantsJson) {
                                    rep.status(500).send({
                                        message: error.message || "Internal Server Error",
                                        statusCode: 500,
                                        error: error.name || "Error",
                                        stack: error.stack ? error.stack.split("\n").map((s: string) => s.trim()) : []
                                    });
                                } else {
                                    rep.status(500).type("text/html").send(`
                                        <div style="font-family: system-ui, -apple-system, sans-serif; padding: 40px; background: #0f172a; color: #f8fafc; min-height: 100vh; box-sizing: border-box;">
                                            <div style="max-width: 1000px; margin: 0 auto;">
                                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                                                    <span style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 14px;">500 RUNTIME ERROR</span>
                                                    <span style="color: #94a3b8; font-size: 14px;">StruxJS Debug Mode</span>
                                                </div>
                                                <h1 style="color: #f8fafc; font-size: 24px; margin: 0 0 16px 0; word-break: break-word;">${error.message || "Unhandled Runtime Exception"}</h1>
                                                <pre style="background: #1e293b; padding: 24px; border-radius: 12px; color: #cbd5e1; overflow-x: auto; font-size: 13px; line-height: 1.6; border: 1px solid #334155;">${error.stack || error}</pre>
                                            </div>
                                        </div>
                                    `);
                                }
                                return;
                            }

                            const httpErr = new HttpException(500, "Internal Server Error");
                            return this.handleHttpException(httpErr, req, rep);
                        }
                    }
                });
            }
        });
        }
    }

    /**
     * Resolve and send a controller result.
     * Handles Resource/ResourceCollection automatically — resolves transform,
     * applies status code, then sends JSON. Plain values pass through as-is.
     */
    private async sendResult(result: any, rep: FastifyReply, req: FastifyRequest): Promise<void> {
        if (rep.sent) return;

        // RedirectResponse instance
        if (result instanceof RedirectResponse) {
            if (!rep.sent && result.getUrl()) {
                result.executeRedirect();
            }
            return;
        }

        // Resource instance — single model transform
        if (Resource.isResource(result)) {
            const { status, body } = await result.resolve();
            rep.status(status).send(body);
            return;
        }

        // ResourceCollection instance — array / pagination transform
        if (ResourceCollection.isResourceCollection(result)) {
            const { status, body } = await result.resolve();
            rep.status(status).send(body);
            return;
        }

        // collect.js Collection — unwrap to plain array
        if (result !== null && typeof result === "object" && typeof result.all === "function" && typeof result.toArray === "function") {
            rep.send(result.all().map((item: any) =>
                item && typeof item.attributes === "object" ? item.attributes : item
            ));
            return;
        }

        // PaginationResult — { data: Collection<T>, total, perPage, currentPage, ... }
        if (result !== null && typeof result === "object" && result.data && typeof result.data.all === "function" && typeof result.total === "number") {
            const items = result.data.all().map((item: any) =>
                item && typeof item.attributes === "object" ? item.attributes : item
            );
            rep.send({
                data: items,
                meta: {
                    total:        result.total,
                    per_page:     result.perPage,
                    current_page: result.currentPage,
                    last_page:    result.lastPage,
                    from:         result.from,
                    to:           result.to
                },
                links: {
                    first: `?page=1`,
                    last:  `?page=${result.lastPage}`,
                    prev:  result.currentPage > 1             ? `?page=${result.currentPage - 1}` : null,
                    next:  result.currentPage < result.lastPage ? `?page=${result.currentPage + 1}` : null
                }
            });
            return;
        }

        // BaseModel instance — unwrap attributes
        if (result !== null && typeof result === "object" && typeof result.attributes === "object") {
            rep.send(result.attributes);
            return;
        }

        // Plain value — pass through
        rep.send(result);
    }

    /**
     * Handle HttpException — render error view for web requests, JSON for API requests
     */
    public handleHttpException(error: HttpException, req: FastifyRequest, rep: FastifyReply): void {
        if (rep.sent) return;

        if ((error as any).__isDd) {
            if ((error as any).__isJsonDd) {
                rep.status(500).type("application/json").send(error.message);
            } else {
                rep.status(500).type("text/html; charset=utf-8").send(error.message);
            }
            return;
        }

        const statusCode = error.statusCode;
        const message = error.message || this.getDefaultMessage(statusCode);

        // Apply custom headers if provided
        if (error.headers) {
            for (const [key, value] of Object.entries(error.headers)) {
                rep.header(key, value);
            }
        }

        // Detect if API or Web Request
        const wantsJson = wantsJsonRequest(req);

        if (wantsJson) {
            // API: Return JSON response
            rep.status(statusCode).send({
                message,
                statusCode
            });
        } else {
            // Web: Render error view
            // Priority: app override → core default
            const appViewPath = path.join(process.cwd(), "resources", "views", "errors", `${statusCode}.strux`);
            const coreViewPath = path.join(path.dirname(new URL(import.meta.url).pathname), "errors", `${statusCode}.strux`);

            let errorViewPath: string | null = null;

            if (fs.existsSync(appViewPath)) {
                // App has custom override
                errorViewPath = appViewPath;
            } else if (fs.existsSync(coreViewPath)) {
                // Fallback to core default
                errorViewPath = coreViewPath;
            }

            if (errorViewPath) {
                const csrfToken = Csrf.generateToken(req, rep);
                const viewData = {
                    csrf_token: csrfToken,
                    _token: csrfToken,
                    message,
                    statusCode
                };

                const engine = new TemplateEngine();
                const htmlResult = engine.render(errorViewPath, viewData);

                rep.status(statusCode).type("text/html; charset=utf-8").send(htmlResult);
            } else {
                // Absolute fallback plain text
                rep.status(statusCode).type("text/plain").send(`${statusCode} - ${message}`);
            }
        }
    }

    /**
     * Get default error message for common HTTP status codes
     */
    private getDefaultMessage(statusCode: number): string {
        const messages: Record<number, string> = {
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            405: "Method Not Allowed",
            408: "Request Timeout",
            419: "Page Expired",
            429: "Too Many Requests",
            500: "Internal Server Error",
            503: "Service Unavailable"
        };

        return messages[statusCode] || "Error";
    }
}
