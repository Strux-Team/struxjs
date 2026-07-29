import { FastifyRequest, FastifyReply } from "fastify";
import { Middleware, Request, Response, auth } from "struxjs";

export class AuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response): Promise<void> {
        if (auth().guest()) {
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
                response.redirect("/login");
            }
        }
    }
}
