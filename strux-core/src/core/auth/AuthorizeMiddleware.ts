import { Middleware } from "../http/Middleware.js";
import { FastifyRequest, FastifyReply } from "fastify";
import { Gate } from "./Gate.js";
import { Auth } from "./Auth.js";
import { HasRoles } from "./HasRoles.js";
import { decorateRequest } from "../http/HttpContext.js";

async function resolveRequestUser(request: FastifyRequest): Promise<any> {
    try {
        const req = decorateRequest(request);
        const attached = req.user();
        if (attached) return attached;

        const user = await Auth.user();
        if (user) {
            req.setUser(user);
            return user;
        }

        if (await Auth.jwt().check()) {
            const jwtUser = await Auth.jwt().user();
            if (jwtUser) {
                req.setUser(jwtUser);
                return jwtUser;
            }
        }
    } catch {}

    return null;
}

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

        const user = await resolveRequestUser(request);
        const allowed = user
            ? await Gate.forUser(user).allows(ability, request.params)
            : await Gate.allows(ability, request.params);

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
        const user = await resolveRequestUser(request);

        if (!user || !HasRoles.hasAnyRole(user, roles)) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `Forbidden. Requires one of the following roles: [${roles.join(", ")}].`
            });
        }
    }
}

/**
 * PermissionMiddleware — Direct permission check middleware
 *
 * Usage in Route:
 *   Route.middleware(['permission:publish-post']).post('/posts', 'PostController@store');
 */
export class PermissionMiddleware implements Middleware {
    public async handle(request: FastifyRequest, reply: FastifyReply, permissionsParam?: string): Promise<void> {
        if (!permissionsParam) {
            return;
        }

        const permissions = permissionsParam.split(",").map(p => p.trim());
        const user = await resolveRequestUser(request);

        const hasPermission = user && permissions.some(p => HasRoles.hasPermissionTo(user, p));
        if (!hasPermission) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `Forbidden. Requires one of the following permissions: [${permissions.join(", ")}].`
            });
        }
    }
}
