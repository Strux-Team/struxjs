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
 *   Route.middleware(new CanMiddleware('edit-post')).get('/posts/:id/edit', 'PostController@edit');
 *   Route.middleware(can('edit-post')).get('/posts/:id/edit', 'PostController@edit');
 */
export class CanMiddleware implements Middleware {
    constructor(private ability?: string) {}

    public static ability(name: string): CanMiddleware {
        return new CanMiddleware(name);
    }

    public async handle(request: FastifyRequest, reply: FastifyReply, ability?: string): Promise<void> {
        const targetAbility = ability || this.ability;
        if (!targetAbility) {
            return;
        }

        const user = await resolveRequestUser(request);
        const allowed = user
            ? await Gate.forUser(user).allows(targetAbility, request.params)
            : await Gate.allows(targetAbility, request.params);

        if (!allowed) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `This action (${targetAbility}) is unauthorized.`
            });
        }
    }

    public toString(): string {
        return this.ability ? `can:${this.ability}` : "CanMiddleware";
    }
}

/**
 * RoleMiddleware — Role-based access control middleware
 *
 * Usage in Route:
 *   Route.middleware(['role:admin,editor']).get('/admin', 'AdminController@index');
 *   Route.middleware(new RoleMiddleware('admin', 'editor')).get('/admin', 'AdminController@index');
 *   Route.middleware(role('admin', 'editor')).get('/admin', 'AdminController@index');
 */
export class RoleMiddleware implements Middleware {
    private roles: string[];

    constructor(...roles: (string | string[])[]) {
        const flat = roles.flat().filter(Boolean);
        if (flat.length === 1 && typeof flat[0] === "string" && flat[0].includes(",")) {
            this.roles = flat[0].split(",").map(r => r.trim());
        } else {
            this.roles = flat.map(r => String(r).trim());
        }
    }

    public static roles(...roles: (string | string[])[]): RoleMiddleware {
        return new RoleMiddleware(...roles);
    }

    public async handle(request: FastifyRequest, reply: FastifyReply, rolesParam?: string): Promise<void> {
        const roles = rolesParam
            ? rolesParam.split(",").map(r => r.trim())
            : this.roles;

        if (!roles || roles.length === 0) {
            return;
        }

        const user = await resolveRequestUser(request);

        if (!user || !HasRoles.hasAnyRole(user, roles)) {
            reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: `Forbidden. Requires one of the following roles: [${roles.join(", ")}].`
            });
        }
    }

    public toString(): string {
        return this.roles.length > 0 ? `role:${this.roles.join(",")}` : "RoleMiddleware";
    }
}

/**
 * PermissionMiddleware — Direct permission check middleware
 *
 * Usage in Route:
 *   Route.middleware(['permission:publish-post']).post('/posts', 'PostController@store');
 *   Route.middleware(new PermissionMiddleware('publish-post')).post('/posts', 'PostController@store');
 *   Route.middleware(permission('publish-post')).post('/posts', 'PostController@store');
 */
export class PermissionMiddleware implements Middleware {
    private permissions: string[];

    constructor(...permissions: (string | string[])[]) {
        const flat = permissions.flat().filter(Boolean);
        if (flat.length === 1 && typeof flat[0] === "string" && flat[0].includes(",")) {
            this.permissions = flat[0].split(",").map(p => p.trim());
        } else {
            this.permissions = flat.map(p => String(p).trim());
        }
    }

    public static permissions(...permissions: (string | string[])[]): PermissionMiddleware {
        return new PermissionMiddleware(...permissions);
    }

    public async handle(request: FastifyRequest, reply: FastifyReply, permissionsParam?: string): Promise<void> {
        const permissions = permissionsParam
            ? permissionsParam.split(",").map(p => p.trim())
            : this.permissions;

        if (!permissions || permissions.length === 0) {
            return;
        }

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

    public toString(): string {
        return this.permissions.length > 0 ? `permission:${this.permissions.join(",")}` : "PermissionMiddleware";
    }
}

/**
 * Fluent helper function to create a CanMiddleware instance
 *
 * @example
 * Route.middleware(can('edit-post')).get('/posts/:id/edit', 'PostController@edit');
 */
export function can(ability: string): CanMiddleware {
    return new CanMiddleware(ability);
}

/**
 * Fluent helper function to create a RoleMiddleware instance
 *
 * @example
 * Route.middleware(role('admin', 'editor')).get('/admin', 'AdminController@index');
 */
export function role(...roles: (string | string[])[]): RoleMiddleware {
    return new RoleMiddleware(...roles);
}

/**
 * Fluent helper function to create a PermissionMiddleware instance
 *
 * @example
 * Route.middleware(permission('publish-post')).post('/posts', 'PostController@store');
 */
export function permission(...permissions: (string | string[])[]): PermissionMiddleware {
    return new PermissionMiddleware(...permissions);
}
