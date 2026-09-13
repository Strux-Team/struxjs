import { Middleware, Request, Response, Auth } from "struxjs";

/**
 * ApiAuthMiddleware — Stateless JWT Bearer token authentication middleware.
 *
 * Usage in Route:
 *   Route.middleware(ApiAuthMiddleware).group(...);
 *   Route.middleware(new ApiAuthMiddleware('admin_api')).group(...);
 *   Route.middleware('apiauth').group(...);
 *   Route.middleware('apiauth:admin_api').group(...);
 */
export class ApiAuthMiddleware implements Middleware {
    constructor(private defaultGuard: string = "api") {}

    public static guard(guardName: string): ApiAuthMiddleware {
        return new ApiAuthMiddleware(guardName);
    }

    public async handle(request: Request, response: Response, guard?: string): Promise<void> {
        const targetGuard = guard || this.defaultGuard;

        // Auth.jwt().check() automatically reads Bearer token from headers and validates it.
        if (!(await Auth.jwt().check(targetGuard))) {
            response.status(401).send({ error: "Unauthorized" });
            return;
        }

        const user = await Auth.jwt().user(targetGuard);
        if (!user) {
            response.status(401).send({ error: "Unauthorized" });
            return;
        }

        request.setUser(user);
    }

    public toString(): string {
        return this.defaultGuard !== "api" ? `apiauth:${this.defaultGuard}` : "ApiAuthMiddleware";
    }
}
