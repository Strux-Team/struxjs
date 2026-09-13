// app/Middleware/ApiAuthMiddleware.ts (Application level)
import { FastifyRequest, FastifyReply } from "fastify";
import { Middleware, Auth } from "struxjs";

/**
 * ApiAuthMiddleware — verifies a JWT Bearer token on every protected API route.
 *
 * Usage in routes/api.ts:
 *   Route.middleware(['apiauth']).group(() => {
 *       Route.get('/me', 'UserController@me');
 *   });
 *
 * Supports per-route guard param:
 *   Route.get('/admin/stats', 'AdminController@stats', { middlewares: ['apiauth:admin'] });
 */
export class ApiAuthMiddleware implements Middleware {
    constructor(private defaultGuard: string = "api") {}

    public static guard(guardName: string): ApiAuthMiddleware {
        return new ApiAuthMiddleware(guardName);
    }

    public async handle(request: FastifyRequest, reply: FastifyReply, guard?: string): Promise<void> {
        const targetGuard = guard || this.defaultGuard;
        const authHeader = request.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            reply.status(401).send({
                message: "Unauthenticated. Bearer token required."
            });
            return;
        }

        const token = authHeader.slice(7).trim();
        const payload = await Auth.jwt().tryVerify(token);

        if (!payload) {
            reply.status(401).send({
                message: "Unauthenticated. Token is invalid or expired."
            });
            return;
        }

        // Reject refresh token from accessing API endpoints
        if (payload.type === "refresh") {
            reply.status(401).send({
                message: "Unauthenticated. Cannot use refresh token to access protected endpoints."
            });
            return;
        }

        // Guard mismatch — e.g. using an 'admin' token on an 'api' route
        if (payload.guard !== targetGuard) {
            reply.status(403).send({
                message: `Forbidden. This route requires the '${targetGuard}' guard.`
            });
            return;
        }

        // Token is valid — resolve user and attach to request context for downstream middlewares & controllers
        const user = await Auth.jwt().user(targetGuard);
        if (!user) {
            reply.status(401).send({
                message: "Unauthenticated. User not found."
            });
            return;
        }

        const req = request as any;
        if (typeof req.setUser === "function") {
            req.setUser(user);
        } else {
            req._authUser = user;
        }
    }

    public toString(): string {
        return this.defaultGuard !== "api" ? `apiauth:${this.defaultGuard}` : "ApiAuthMiddleware";
    }
}
