import { Middleware, Request, Response, Auth } from "struxjs";

/**
 * AuthMiddleware — Web Session authentication middleware.
 *
 * Usage in Route:
 *   Route.middleware(AuthMiddleware).group(...);
 *   Route.middleware(new AuthMiddleware("/admin/login")).group(...);
 *   Route.middleware("auth:/admin/login").group(...);
 *   Route.middleware("auth:/admin/login,admin").group(...);
 */
export class AuthMiddleware implements Middleware {
    constructor(
        private redirectTo: string = "/login",
        private guard: string = "web"
    ) {}

    public static redirectTo(url: string, guard: string = "web"): AuthMiddleware {
        return new AuthMiddleware(url, guard);
    }

    public async handle(
        request: Request,
        response: Response,
        redirectParam?: string,
        guardParam?: string
    ): Promise<void> {
        const targetRedirect = redirectParam || this.redirectTo;
        const targetGuard = guardParam || this.guard;

        if (await Auth.guard(targetGuard).guest()) {
            const wantsJson = (request as any).headers?.accept?.includes("application/json")
                || (request as any).url?.startsWith("/api/");

            if (wantsJson) {
                response.status(401).send({ error: "Unauthenticated." });
                return;
            }

            response.redirect(targetRedirect);
        }
    }

    public toString(): string {
        return this.redirectTo !== "/login" ? `auth:${this.redirectTo}` : "AuthMiddleware";
    }
}
