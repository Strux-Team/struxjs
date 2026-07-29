import { BaseModel } from "struxjs";

export class User extends BaseModel {
    protected table = "users";

    // protected fillable: string[] = ['name'];

    declare id: number;
    declare name: string;
    declare email: string;
    declare password: string;
}
