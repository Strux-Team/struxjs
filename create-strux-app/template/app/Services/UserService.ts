export class UserService {
    public async getUserProfile(userId: number) {
        return {
            id: userId,
            name: "John Doe",
            email: "john@example.com"
        };
    }
}
