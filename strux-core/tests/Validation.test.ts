import { describe, test, expect } from "vitest";
import { FormRequest, ValidationError, validatePayload } from "../src/index.js";

class RegisterRequest extends FormRequest {
    public rules() {
        return {
            name: "required|min:3",
            email: "required|email",
            password: "required|min:6|confirmed",
            role: "required|in:admin,user",
        };
    }
}

describe("Validation Engine", () => {
    test("passes valid payload", async () => {
        const payload = {
            name: "John Doe",
            email: "john@example.com",
            password: "secretpassword",
            password_confirmation: "secretpassword",
            role: "user",
        };

        const validated = await validatePayload(payload, {
            name: "required|min:3",
            email: "required|email",
            password: "required|min:6|confirmed",
            role: "required|in:admin,user",
        });

        expect(validated).toEqual({
            name: "John Doe",
            email: "john@example.com",
            password: "secretpassword",
            role: "user",
        });
    });

    test("throws ValidationError for invalid fields", async () => {
        const invalidPayload = {
            name: "Jo",
            email: "not-an-email",
            password: "123",
            password_confirmation: "456",
            role: "invalid-role",
        };

        try {
            await validatePayload(invalidPayload, {
                name: "required|min:3",
                email: "required|email",
                password: "required|min:6|confirmed",
                role: "required|in:admin,user",
            });
            expect.fail("Should have thrown ValidationError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(ValidationError);
            const errors = (err as ValidationError).errors;

            expect(errors.name).toContain("The name must be at least 3 characters.");
            expect(errors.email).toContain("The email must be a valid email address.");
            expect(errors.password).toContain("The password must be at least 6 characters.");
            expect(errors.role).toContain("The selected role is invalid.");
        }
    });

    test("FormRequest boots and validates correctly", async () => {
        const req = new RegisterRequest();
        const mockFastifyReq: any = {
            body: {
                name: "Alice",
                email: "alice@example.com",
                password: "password123",
                password_confirmation: "password123",
                role: "admin",
            },
        };

        await req.boot(mockFastifyReq);

        expect(req.input("name")).toBe("Alice");
        expect(req.input("role")).toBe("admin");
        expect(req.all()).toEqual({
            name: "Alice",
            email: "alice@example.com",
            password: "password123",
            role: "admin",
        });
    });

    test("custom rule callback validation", async () => {
        const isEven = (val: number) => val % 2 === 0;

        const validated = await validatePayload({ num: 4 }, { num: [isEven] });
        await expect(validatePayload({ num: 5 }, { num: [isEven] })).rejects.toThrow(ValidationError);
    });

    test("FormRequest accesses route parameters via param() and params", async () => {
        class UpdateUserRequest extends FormRequest {
            public rules() {
                const userId = this.param("id");
                return {
                    email: "required|email",
                    userIdCheck: `required|min:${userId.length}`
                };
            }
        }

        const req = new UpdateUserRequest();
        const mockFastifyReq: any = {
            params: { id: "42" },
            body: { email: "newemail@example.com", userIdCheck: "123" }
        };

        await req.boot(mockFastifyReq);

        expect(req.param("id")).toBe("42");
        expect(req.params.id).toBe("42");
        expect(req.routeParam("id")).toBe("42");
    });

    test("validates data types correctly (string, boolean, integer, array, date)", async () => {
        const payload = {
            str: "hello",
            boolTrue: true,
            boolFalse: "0",
            num: 42,
            arr: [1, 2, 3],
            dt: "2026-08-25"
        };

        const validated = await validatePayload(payload, {
            str: "string",
            boolTrue: "boolean",
            boolFalse: "boolean",
            num: "integer",
            arr: "array",
            dt: "date"
        });

        expect(validated.str).toBe("hello");

        const invalidPayload = {
            str: 123,
            bool: "yes",
            num: 3.14,
            arr: "not array",
            dt: "not a date"
        };

        try {
            await validatePayload(invalidPayload, {
                str: "string",
                bool: "boolean",
                num: "integer",
                arr: "array",
                dt: "date"
            });
            expect.fail("Should have thrown ValidationError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(ValidationError);
            const errors = (err as ValidationError).errors;

            expect(errors.str).toContain("The str must be a string.");
            expect(errors.bool).toContain("The bool field must be true or false.");
            expect(errors.num).toContain("The num must be an integer.");
            expect(errors.arr).toContain("The arr must be an array.");
            expect(errors.dt).toContain("The dt is not a valid date.");
        }
    });

    test("validates nullable and optional correctly", async () => {
        const payload = {
            name: "John",
            bio: null, // nullable -> pass
            // age missing -> optional -> pass
        };

        const validated = await validatePayload(payload, {
            name: "required|string",
            bio: "nullable|string",
            age: "optional|integer"
        });

        expect(validated.name).toBe("John");
        expect(validated.bio).toBe(null);

        const invalidPayload = {
            name: "John",
            bio: null, // missing nullable, should fail string rule
        };

        try {
            await validatePayload(invalidPayload, {
                name: "required|string",
                bio: "string", // null fails because not nullable
            });
            expect.fail("Should have thrown ValidationError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(ValidationError);
            const errors = (err as ValidationError).errors;
            expect(errors.bio).toContain("The bio must be a string.");
        }
    });
});

