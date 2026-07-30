import crypto from "crypto";
import { FastifyRequest, FastifyReply } from "fastify";

export class Csrf {
    private static COOKIE_NAME = "XSRF-TOKEN";

    /**
     * Generate or retrieve existing CSRF token for the request session
     */
    public static generateToken(req: FastifyRequest, reply: FastifyReply): string {
        const cookies = req.headers.cookie || "";
        const match = cookies.match(new RegExp(`(?:^|; )\\s*${this.COOKIE_NAME}\\s*=\\s*([^;]+)`));
        
        if (match && match[1]) {
            return decodeURIComponent(match[1]);
        }

        const token = crypto.randomBytes(32).toString("hex");

        // Set XSRF-TOKEN cookie for Fastify response
        reply.header(
            "Set-Cookie",
            `${this.COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`
        );

        return token;
    }

    /**
     * Get active CSRF token from incoming request cookies
     */
    public static getToken(req: FastifyRequest): string | null {
        const cookies = req.headers.cookie || "";
        const match = cookies.match(new RegExp(`(?:^|; )\\s*${this.COOKIE_NAME}\\s*=\\s*([^;]+)`));
        return match && match[1] ? decodeURIComponent(match[1]) : null;
    }

    /**
     * Verify if incoming request contains a valid CSRF token
     */
    public static verifyToken(req: FastifyRequest): boolean {
        const expectedToken = this.getToken(req);
        if (!expectedToken) return false;

        const body = (req.body as Record<string, any>) || {};
        let tokenFromBody = body._token;
        if (tokenFromBody && typeof tokenFromBody === "object") {
            tokenFromBody = tokenFromBody.value !== undefined ? tokenFromBody.value : String(tokenFromBody);
        }

        const tokenFromHeader = (req.headers["x-csrf-token"] || req.headers["x-xsrf-token"]) as string;

        const providedToken = typeof tokenFromBody === "string" && tokenFromBody ? tokenFromBody : (typeof tokenFromHeader === "string" ? tokenFromHeader : null);

        if (!providedToken) return false;

        const bufProvided = Buffer.from(providedToken);
        const bufExpected = Buffer.from(expectedToken);

        if (bufProvided.length !== bufExpected.length) {
            return false;
        }

        return crypto.timingSafeEqual(bufProvided, bufExpected);
    }
}
