import { Auth, Request, Response, view } from "struxjs";

export class LoginController {
    public async index() {
        return view('login')
    }

    public async login(request: Request) {
        const { email, password } = request.all();

        const ok = await Auth.attempt({ email, password });

        console.log(ok);


        return 'ok';
    }

    public async logout() {
        await Auth.logout();

    }
}
