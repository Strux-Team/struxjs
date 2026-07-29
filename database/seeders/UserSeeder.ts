import { Auth, Seeder } from "struxjs";
import { User } from "../../app/Models/User.ts";

export default class UserSeeder extends Seeder {
    public async run(): Promise<void> {
        // Sử dụng UserFactory để sinh ngẫu nhiên 10 User bằng @faker-js/faker
        // await UserFactory.new().count(10).create();
        await User.create({
            name: 'An',
            email: 'an@gmail.com',
            password: await Auth.hashPassword('123456')
        })
    }
}
