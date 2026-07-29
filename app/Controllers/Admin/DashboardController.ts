import { Request, Response } from "struxjs";

export class DashboardController {
    public async index(request: Request, response: Response) {
        return response.json({
            message: "Hello from DashboardController!"
        });
    }
}
