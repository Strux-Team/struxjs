import { Request, view } from "struxjs";

export class HomeController {
    public async index(request: Request) {
        return view('welcome', { title: 'Welcome to StruxJS' });
    }
}
