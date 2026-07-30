import { FastifyReply } from "fastify";
import { route } from "./Route.js";
import { decorateRequest } from "./HttpContext.js";

export class RedirectResponse {
    private targetUrl?: string;
    private statusCode: number = 302;
    private reply: FastifyReply;

    constructor(reply: FastifyReply, targetUrl?: string, statusCode: number = 302) {
        this.reply = reply;
        this.targetUrl = targetUrl;
        this.statusCode = statusCode;

        if (targetUrl) {
            this.executeRedirect();
        }
    }

    /**
     * Get target URL
     */
    public getUrl(): string | undefined {
        return this.targetUrl;
    }

    /**
     * Get status code
     */
    public getStatusCode(): number {
        return this.statusCode;
    }

    /**
     * Internal execution of redirect HTTP headers
     */
    public executeRedirect(): void {
        if (this.targetUrl && !this.reply.sent) {
            if (this.reply.raw && typeof this.reply.raw.setHeader === "function") {
                this.reply.raw.setHeader("Location", this.targetUrl);
            }
            this.reply.header("location", this.targetUrl).code(this.statusCode).send();
        }
    }

    /**
     * Redirect to a specific URL
     */
    public to(url: string, statusCode = 302): this {
        this.targetUrl = url;
        this.statusCode = statusCode;
        this.executeRedirect();
        return this;
    }

    /**
     * Redirect to a named route (e.g. response.redirect().route('users.index') or response.redirect().route('users.show', { id: 1 }))
     */
    public route(name: string, params: Record<string, any> = {}, query: Record<string, any> = {}, statusCode = 302): this {
        const targetUrl = route(name, params, query);
        return this.to(targetUrl, statusCode);
    }

    /**
     * Redirect back to previous URL using HTTP Referer header or fallback
     */
    public back(fallback = "/", statusCode = 302): this {
        const req = (this.reply as any).request;
        const referer = req?.headers?.referer || req?.headers?.referrer || fallback;
        return this.to(referer, statusCode);
    }

    /**
     * Flash key-value data into Session for the next HTTP request
     */
    public with(key: string | Record<string, any>, value?: any): this {
        const req = (this.reply as any).request;
        if (req && typeof req.session === "function") {
            const sessionStore = req.session();
            if (sessionStore && typeof sessionStore.flash === "function") {
                if (typeof key === "object" && key !== null) {
                    for (const [k, v] of Object.entries(key)) {
                        sessionStore.flash(k, v);
                    }
                } else {
                    sessionStore.flash(key, value);
                }
            }
        }
        return this;
    }

    /**
     * Flash input data to Session for old() helper
     */
    public withInput(input?: Record<string, any>): this {
        const req = (this.reply as any).request;
        if (req) {
            const decorated = decorateRequest(req);
            const dataToFlash = input || decorated.all();
            return this.with("old", dataToFlash);
        }
        return this;
    }

    /**
     * Flash error messages to Session for errors helper
     */
    public withErrors(errors: any): this {
        return this.with("errors", errors);
    }
}
