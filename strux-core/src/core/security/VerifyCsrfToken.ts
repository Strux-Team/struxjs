import { Middleware } from "../http/Middleware.js";
import { FastifyRequest, FastifyReply } from "fastify";
import { Csrf } from "./Csrf.js";
import { HttpException } from "../http/HttpException.js";

export class VerifyCsrfToken implements Middleware {
    /**
     * The URIs that should be excluded from CSRF verification.
     * e.g. ['/api/*', '/stripe/webhook']
     */
    protected except: string[] = [];

    protected static globalExcept: string[] = [];

    /**
     * Register URIs that should be excluded from CSRF verification globally
     */
    public static except(urls: string | string[]): typeof VerifyCsrfToken {
        const list = Array.isArray(urls) ? urls : [urls];
        this.globalExcept = Array.from(new Set(this.globalExcept.concat(list)));
        return this;
    }

    public async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        // Safe HTTP methods do not require CSRF protection
        const method = request.method.toUpperCase();
        if (["GET", "HEAD", "OPTIONS"].includes(method)) {
            Csrf.generateToken(request, reply);
            return;
        }

        // Check route exclusions
        const url = request.url.split("?")[0];
        const allExcept = [...this.except, ...VerifyCsrfToken.globalExcept];

        for (const pattern of allExcept) {
            const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
            if (regex.test(url)) {
                return;
            }
        }

        // Verify CSRF token for POST, PUT, PATCH, DELETE
        const isValid = Csrf.verifyToken(request);
        if (!isValid) {
            throw new HttpException(419, "CSRF token mismatch. Please refresh the page and try again.");
        }
    }
}
