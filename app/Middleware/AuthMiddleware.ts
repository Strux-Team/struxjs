import { Middleware, Request, Response, auth } from "struxjs";

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
        private guard?: string
    ) {}

    public static redirectTo(url: string, guard?: string): AuthMiddleware {
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

        if (auth(targetGuard).guest()) {
            // API requests → 401 JSON
            const isApiRoute = request.url.startsWith("/api/") || request.url === "/api";
            const wantsJson =
                (request.headers.accept || "").includes("application/json") ||
                request.headers["x-requested-with"] === "XMLHttpRequest" ||
                isApiRoute;

            if (wantsJson) {
                response.status(401).send({ message: "Unauthenticated." });
            } else {
                // Web requests → redirect to login page
                response.redirect(targetRedirect);
            }
        }
    }

    public toString(): string {
        return this.redirectTo !== "/login" ? `auth:${this.redirectTo}` : "AuthMiddleware";
    }
}
