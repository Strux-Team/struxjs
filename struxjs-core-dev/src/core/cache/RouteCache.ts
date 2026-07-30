import { Middleware } from "../http/Middleware.js";
import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";

const memoryCache = new Map<string, { payload: any; contentType: string; etag: string; expiresAt: number }>();

export class RouteCacheMiddleware implements Middleware {
    public async handle(request: FastifyRequest, reply: FastifyReply, durationParam?: string): Promise<void> {
        const durationSeconds = Number(durationParam) || 60;
        const cacheKey = `route_cache:${request.method}:${request.url}`;
        const now = Date.now();

        // 1. Check existing cached response payload
        const cached = memoryCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            // Check ETag 304 Not Modified
            const ifNoneMatch = request.headers["if-none-match"];
            if (ifNoneMatch && ifNoneMatch === cached.etag) {
                reply.status(304).send();
                return;
            }

            reply.header("ETag", cached.etag);
            reply.header("Cache-Control", `public, max-age=${durationSeconds}`);
            reply.type(cached.contentType).send(cached.payload);
            return;
        }

        // 2. Intercept response payload to populate cache
        const originalSend = reply.send.bind(reply);
        (reply as any).send = function (payload: any) {
            try {
                if (reply.statusCode === 200 && payload !== undefined) {
                    const rawPayload = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
                    const etag = `W/"${crypto.createHash("md5").update(rawPayload).digest("hex")}"`;
                    const contentType = (reply.getHeader("content-type") as string) || "application/json";

                    memoryCache.set(cacheKey, {
                        payload,
                        contentType,
                        etag,
                        expiresAt: Date.now() + durationSeconds * 1000
                    });

                    reply.header("ETag", etag);
                    reply.header("Cache-Control", `public, max-age=${durationSeconds}`);
                }
            } catch {
                // Ignore cache serialization errors
            }
            return originalSend(payload);
        };
    }

    public static clear(): void {
        memoryCache.clear();
    }
}
