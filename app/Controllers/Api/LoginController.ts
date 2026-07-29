import { Auth, Request, Response } from "struxjs";
import { User } from "../../Models/User.js";
import { UserResource } from "../../Resources/UserResource.js";

export class LoginController {
    public async index(request: Request, response: Response) {
        const { email, password } = request.all();

        const result = await Auth.jwt().attempt({ email, password });

        if (!result) {
            return response.status(401).json({ message: "Invalid credentials." });
        }

        return response.json({
            token: result.token,
            refreshToken: result.refreshToken,
            expiresIn: result.expiresIn,
        });
    }

    public async profile() {
        const user = await Auth.jwt().user<User>();
        return new UserResource(user);
    }

    public async logout() {
        return await Auth.jwt().invalidateRequestToken();
    }

    public async refresh(request: Request, response: Response) {
        const { refreshToken } = request.all();

        try {
            const result = await Auth.jwt().refreshToken(refreshToken);
            return response.json(result);
        } catch (error: any) {
            return response.status(401).json({ message: error.message });
        }
    }
}
