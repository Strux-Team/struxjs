import path from "path";
import fs from "fs";
import { Container } from "../container/Container.js";
import { Router } from "./Router.js";
import { TemplateEngine } from "../view/TemplateEngine.js";
import { Csrf } from "../security/Csrf.js";
import { config, env } from "../config/Config.js";
import { Log } from "../log/Log.js";
import fastifyStatic from "@fastify/static";

import { wantsJsonRequest } from "./HttpContext.js";
import { HttpException } from "./HttpException.js";

export class HttpServiceProvider {
    constructor(protected container: Container) { }

    /**
     * Register HTTP services into the container
     */
    public register(): void {
        // Bind Router as a singleton so the whole application shares the same route map
        this.container.singleton("router", (c) => new Router(c));
        this.container.make("router");
    }

    /**
     * Start the HTTP Server network listener
     */
    public async boot(): Promise<void> {
        const router = this.container.make<Router>("router");
        const fastify = router.getEngine();

        // Serve static files from public/ directory
        // e.g. public/build/app.js → GET /build/app.js
        const publicDir = path.join(process.cwd(), "public");
        if (fs.existsSync(publicDir)) {
            await fastify.register(fastifyStatic, {
                root: publicDir,
                prefix: "/",
                decorateReply: false
            });
        }

        // Register 404 handler for unmatched routes
        fastify.setNotFoundHandler((req, rep) => {
            const wantsJson = wantsJsonRequest(req);

            if (wantsJson) {
                rep.status(404).send({
                    message: "Not Found",
                    statusCode: 404
                });
            } else {
                const appViewPath = path.join(process.cwd(), "resources", "views", "errors", "404.strux");
                const coreViewPath = path.join(path.dirname(new URL(import.meta.url).pathname), "errors", "404.strux");

                const errorViewPath = fs.existsSync(appViewPath) ? appViewPath
                    : fs.existsSync(coreViewPath) ? coreViewPath
                    : null;

                if (errorViewPath) {
                    const csrfToken = Csrf.generateToken(req, rep);
                    const engine = new TemplateEngine();
                    const html = engine.render(errorViewPath, {
                        csrf_token: csrfToken,
                        _token: csrfToken,
                        message: "The page you're looking for could not be found.",
                        statusCode: 404
                    });
                    rep.status(404).type("text/html").send(html);
                } else {
                    rep.status(404).type("text/plain").send("404 - Not Found");
                }
            }
        });

        // Register Global Error Handler (respects APP_DEBUG)
        fastify.setErrorHandler((error: any, req, rep) => {
            if (rep.sent || error?.__isDd) return;
            Log.error(error, { url: req.url, method: req.method, ip: req.ip });

            // Delegate HTTP status exceptions (< 500, e.g. 404, 419, 403) to Router's handleHttpException
            if (HttpException.isHttpException(error) || (error.statusCode && error.statusCode < 500)) {
                const httpErr = HttpException.isHttpException(error)
                    ? error
                    : new HttpException(error.statusCode, error.message);
                return router.handleHttpException(httpErr, req, rep);
            }
            const isDebug = config("app.debug") ?? env("APP_DEBUG", true);
            const statusCode = error.statusCode || 500;

            const wantsJson = wantsJsonRequest(req);

            if (wantsJson) {
                if (isDebug) {
                    rep.status(statusCode).send({
                        message: error.message || "Internal Server Error",
                        statusCode: statusCode,
                        error: error.name || "Error",
                        stack: error.stack ? error.stack.split("\n").map((s: string) => s.trim()) : []
                    });
                } else {
                    rep.status(statusCode).send({
                        message: statusCode === 500 ? "Internal Server Error" : error.message,
                        statusCode: statusCode
                    });
                }
            } else {
                if (isDebug) {
                    rep.status(statusCode).type("text/html").send(`
                        <div style="font-family: system-ui, -apple-system, sans-serif; padding: 40px; background: #0f172a; color: #f8fafc; min-height: 100vh; box-sizing: border-box;">
                            <div style="max-width: 1000px; margin: 0 auto;">
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                                    <span style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 14px;">${statusCode} ERROR</span>
                                    <span style="color: #94a3b8; font-size: 14px;">StruxJS Debug Mode</span>
                                </div>
                                <h1 style="color: #f8fafc; font-size: 26px; margin: 0 0 16px 0; word-break: break-word;">${error.message || "Unhandled Runtime Exception"}</h1>
                                <pre style="background: #1e293b; padding: 24px; border-radius: 12px; color: #cbd5e1; overflow-x: auto; font-size: 13px; line-height: 1.6; border: 1px solid #334155;">${error.stack || error}</pre>
                            </div>
                        </div>
                    `);
                } else {
                    const csrfToken = Csrf.generateToken(req, rep);
                    const engine = new TemplateEngine();
                    const appViewPath = path.join(process.cwd(), "resources", "views", "errors", "500.strux");
                    const coreViewPath = path.join(path.dirname(new URL(import.meta.url).pathname), "errors", "500.strux");
                    const errorViewPath = fs.existsSync(appViewPath) ? appViewPath : fs.existsSync(coreViewPath) ? coreViewPath : null;

                    if (errorViewPath) {
                        const html = engine.render(errorViewPath, {
                            csrf_token: csrfToken,
                            _token: csrfToken,
                            message: "500 - Internal Server Error",
                            statusCode: 500
                        });
                        rep.status(500).type("text/html").send(html);
                    } else {
                        rep.status(500).type("text/plain").send("500 - Internal Server Error");
                    }
                }
            }
        });

        const appConfig = config("app") || {};
        const port = Number(appConfig.port || process.env.PORT || 3000);
        const host = appConfig.host || process.env.HOST || "127.0.0.1";
        const appName = appConfig.name || "StruxJS";
        const appUrl = appConfig.url || `http://localhost:${port}`;

        try {
            await fastify.listen({ port, host });
            console.log(`[${appName}] Core Engine successfully booted.`);
            console.log(`[${appName}] HTTP Server listening at ${appUrl}`);
        } catch (err: any) {
            console.error(`[${appName} Boot Error]:`, err.message || err);
            fastify.log.error(err);
            process.exit(1);
        }
    }
}
