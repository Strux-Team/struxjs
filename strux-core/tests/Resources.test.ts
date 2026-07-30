import { describe, test, expect } from "vitest";
import { Resource } from "../src/index.js";

class UserResource extends Resource {
    public transform(user: any) {
        return {
            id: user.id,
            fullName: `${user.firstName} ${user.lastName}`,
            email: user.email.toLowerCase(),
        };
    }
}

describe("JsonResource Transformers", () => {
    test("transforms single model object with data wrapper", async () => {
        const user = { id: 1, firstName: "John", lastName: "Doe", email: "John@Example.com" };
        const resource = UserResource.make(user).additional({ status: "success" });

        const result = await resource.resolve();

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            data: {
                id: 1,
                fullName: "John Doe",
                email: "john@example.com",
            },
            status: "success",
        });
    });

    test("transforms array collection with Resource.collection()", async () => {
        const users = [
            { id: 1, firstName: "Alice", lastName: "Smith", email: "alice@test.com" },
            { id: 2, firstName: "Bob", lastName: "Jones", email: "bob@test.com" },
        ];

        const collection = UserResource.collection(users);
        const result = await collection.resolve();

        expect(result.body.data).toHaveLength(2);
        expect(result.body.data[0].fullName).toBe("Alice Smith");
        expect(result.body.data[1].fullName).toBe("Bob Jones");
    });

    test("formats paginated data with meta and links", async () => {
        const paginated = {
            data: [{ id: 1, firstName: "Charlie", lastName: "Brown", email: "c@test.com" }],
            total: 50,
            perPage: 10,
            currentPage: 2,
            lastPage: 5,
        };

        const collection = UserResource.collection(paginated);
        const result = await collection.resolve();

        expect(result.body.data).toHaveLength(1);
        expect(result.body.meta).toEqual({
            total: 50,
            per_page: 10,
            current_page: 2,
            last_page: 5,
            from: null,
            to: null,
        });
        expect(result.body.links.prev).toBe("?page=1");
        expect(result.body.links.next).toBe("?page=3");
    });
});
