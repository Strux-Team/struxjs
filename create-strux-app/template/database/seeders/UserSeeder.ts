import { Auth, Seeder } from "struxjs";
import { User } from "../../app/Models/User.ts";

export default class UserSeeder extends Seeder {
    public async run(): Promise<void> {
        // Use UserFactory to randomly generate 10 Users using @faker-js/faker
        // await UserFactory.new().count(10).create()
    }
}
