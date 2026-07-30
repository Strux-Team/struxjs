import { Request, Response } from "struxjs";

export class ApiController {
    public async index(request: Request, response: Response) {
        return {
            status: "success",
            message: "Welcome to StruxJS API"
        };
    }
}
