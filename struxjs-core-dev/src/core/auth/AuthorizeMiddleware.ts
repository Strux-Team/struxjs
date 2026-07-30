import { Middleware } from "../http/Middleware.js";
import { FastifyRequest, FastifyReply } from "fastify";
import { Gate } from "./Gate.js";
import { Auth } from "./Auth.js";
import { HasRoles } from "./HasRoles.js";

/**
 * CanMiddleware — Gate ability authorization gate middleware
 *
 * Usage in Route:
 *   Route.middleware(['can:edit-post']).get('/posts/:id/edit', 'PostController@edit');
 */
export class CanMiddleware implements Middleware {
    public async handle(request: FastifyRequest, reply: FastifyReply, ability?: string): Promise<void> {
        if (!ability) {
            return;
        }

        const allowed = await Gate.allows(ability, request.params);
        if (!allowed) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `This action (${ability}) is unauthorized.`
            });
        }
    }
}

/**
 * RoleMiddleware — Role-based access control middleware
 *
 * Usage in Route:
 *   Route.middleware(['role:admin,editor']).get('/admin', 'AdminController@index');
 */
export class RoleMiddleware implements Middleware {
    public async handle(request: FastifyRequest, reply: FastifyReply, rolesParam?: string): Promise<void> {
        if (!rolesParam) {
            return;
        }

        const roles = rolesParam.split(",").map(r => r.trim());
        const user = await Auth.user();

        if (!user || !HasRoles.hasAnyRole(user, roles)) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `Forbidden. Requires one of the following roles: [${roles.join(", ")}].`
            });
        }
    }
}
