import { BaseModel } from "struxjs";

export class User extends BaseModel {
    protected table = "users";

    declare id: number;
    declare name: string;
    declare email: string;
    declare password: string;
}
