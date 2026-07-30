import { Middleware, Request, Response, Auth } from "struxjs";

export class AuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response): Promise<void> {
        if (Auth.guest()) {
            response.redirect("/login");
        }
    }
}
