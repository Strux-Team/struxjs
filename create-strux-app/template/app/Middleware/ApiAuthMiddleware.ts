import { Middleware, Request, Response, Auth } from "struxjs";

export class ApiAuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response, guard = "api"): Promise<void> {
        // Auth.jwt().check() automatically reads Bearer token from headers and validates it.
        if (!(await Auth.jwt().check(guard))) {
            response.status(401).send({ error: "Unauthorized" });
            return;
        }

        const user = await Auth.jwt().user(guard);
        if (!user) {
            response.status(401).send({ error: "Unauthorized" });
            return;
        }

        request.setUser(user);
    }
}
