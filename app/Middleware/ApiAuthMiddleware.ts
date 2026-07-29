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
    public async handle(request: FastifyRequest, reply: FastifyReply, guard = "api"): Promise<void> {
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

        // Guard mismatch — e.g. using an 'admin' token on an 'api' route
        if (payload.guard !== guard) {
            reply.status(403).send({
                message: `Forbidden. This route requires the '${guard}' guard.`
            });
            return;
        }

        // Token is valid — request proceeds to the Controller
    }
}
