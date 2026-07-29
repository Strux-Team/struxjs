import { Resource } from "struxjs";

export class UserResource extends Resource {
    public transform(user: any) {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            created_at: user.created_at,
        };
    }
}
