import { Request } from "../http/Request.js";
import { Response } from "../http/Response.js";
import { Cache } from "../cache/Cache.js";
import { HttpException } from "../http/HttpException.js";

/**
 * ThrottleRequests Middleware
 * 
 * Limits the number of HTTP requests a client can make within a specified time window.
 * 
 * Usage in routes:
 *   Route.get('/api/data', 'DataController@index').middleware(['throttle:60,1']) 
 *   // 60 requests per 1 minute
 */
export class ThrottleRequests {
    
    /**
     * Handle the incoming request.
     * 
     * @param request The HTTP request context
     * @param response The HTTP response context
     * @param args Middleware arguments: [maxAttempts, decayMinutes, prefix]
     */
    public async handle(request: Request, response: Response, ...args: string[]): Promise<void> {
        const maxAttempts = parseInt(args[0] || "60", 10);
        const decayMinutes = parseFloat(args[1] || "1");
        const prefix = args[2] || "throttle";

        // Generate a unique signature for the client.
        // Uses the authenticated user ID if available, otherwise the client's IP address.
        const identifier = (request as any).user?.id || request.ip || "unknown-ip";
        
        // Key format: throttle:127.0.0.1:/api/data
        const routePath = request.url.split('?')[0]; 
        const key = `${prefix}:${identifier}:${routePath}`;

        // Attempt to fetch current hits from Cache
        const currentHits = await Cache.get<number>(key);

        if (currentHits !== null && currentHits >= maxAttempts) {
            // Rate limit exceeded
            response.header("X-RateLimit-Limit", String(maxAttempts));
            response.header("X-RateLimit-Remaining", "0");
            response.header("Retry-After", String(Math.ceil(decayMinutes * 60)));

            throw new HttpException(429, "Too Many Requests");
        }

        // We use add() + increment() to avoid race conditions as much as possible 
        // without writing complex LUA scripts. If 'add' succeeds, it's the first hit.
        const isFirstHit = await Cache.add(key, 1, Math.ceil(decayMinutes * 60));
        
        let newHits = 1;
        if (!isFirstHit) {
            newHits = await Cache.increment(key, 1);
        }

        response.header("X-RateLimit-Limit", String(maxAttempts));
        response.header("X-RateLimit-Remaining", String(Math.max(0, maxAttempts - newHits)));
    }
}
