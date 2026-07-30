import { Factory } from "struxjs";
import { User } from "../../app/Models/User.ts";

export class UserFactory extends Factory<User> {
    protected model = User;

    /**
     * Define the model's default state.
     */
    public definition(): Record<string, any> {
        return {
            name: this.faker.person.fullName(),
            email: this.faker.internet.email(),
            status: true
        };
    }
}
