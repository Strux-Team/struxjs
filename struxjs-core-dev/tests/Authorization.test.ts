import { describe, test, expect, beforeEach } from "vitest";
import { Gate, AuthorizationError, HasRoles, TemplateEngine } from "../src/index.js";

// Mock User Model
class TestUser {
    public id: number;
    public name: string;
    public roles: string[];
    public permissions: string[];

    constructor(id: number, name: string, roles: string[] = [], permissions: string[] = []) {
        this.id = id;
        this.name = name;
        this.roles = roles;
        this.permissions = permissions;
    }
}

// Mock Post Model
class TestPost {
    constructor(public id: number, public userId: number, public title: string) {}
}

// Mock Post Policy Class
class TestPostPolicy {
    public update(user: TestUser, post: TestPost): boolean {
        return user.id === post.userId || HasRoles.hasRole(user, "admin");
    }

    public delete(user: TestUser, post: TestPost): boolean {
        return HasRoles.hasRole(user, "admin");
    }
}

describe("Authorization and RBAC System", () => {
    beforeEach(() => {
        Gate.reset();
    });

    test("defines and evaluates basic ability gates", async () => {
        Gate.define("edit-settings", (user: any) => {
            return user && user.roles.includes("admin");
        });

        const admin = new TestUser(1, "Admin", ["admin"]);
        const editor = new TestUser(2, "Editor", ["editor"]);

        expect(await Gate.forUser(admin).allows("edit-settings")).toBe(true);
        expect(await Gate.forUser(editor).allows("edit-settings")).toBe(false);
        expect(await Gate.forUser(editor).denies("edit-settings")).toBe(true);
    });

    test("evaluates before and after hooks", async () => {
        Gate.before((user: any) => {
            if (user && user.roles.includes("super-admin")) {
                return true;
            }
        });

        Gate.define("restricted-action", () => false);

        const superAdmin = new TestUser(1, "SuperAdmin", ["super-admin"]);
        const regularUser = new TestUser(2, "User", ["user"]);

        expect(await Gate.forUser(superAdmin).allows("restricted-action")).toBe(true);
        expect(await Gate.forUser(regularUser).allows("restricted-action")).toBe(false);
    });

    test("evaluates class policies", async () => {
        Gate.policy(TestPost, TestPostPolicy);

        const author = new TestUser(10, "Author");
        const stranger = new TestUser(20, "Stranger");
        const admin = new TestUser(1, "Admin", ["admin"]);
        const post = new TestPost(101, 10, "First Post");

        expect(await Gate.forUser(author).allows("update", post)).toBe(true);
        expect(await Gate.forUser(stranger).allows("update", post)).toBe(false);
        expect(await Gate.forUser(admin).allows("update", post)).toBe(true);
        expect(await Gate.forUser(author).allows("delete", post)).toBe(false);
        expect(await Gate.forUser(admin).allows("delete", post)).toBe(true);
    });

    test("throws AuthorizationError on Gate.authorize failure", async () => {
        Gate.define("publish-post", () => false);

        const user = new TestUser(1, "User");

        await expect(Gate.forUser(user).authorize("publish-post")).rejects.toThrow(AuthorizationError);
    });

    test("HasRoles helper assigns, checks, and revokes roles/permissions", () => {
        const user = new TestUser(1, "Alex");

        HasRoles.assignRole(user, "editor", "moderator");
        expect(HasRoles.hasRole(user, "editor")).toBe(true);
        expect(HasRoles.hasAnyRole(user, ["admin", "editor"])).toBe(true);
        expect(HasRoles.hasAllRoles(user, ["editor", "moderator"])).toBe(true);

        HasRoles.removeRole(user, "moderator");
        expect(HasRoles.hasRole(user, "moderator")).toBe(false);

        HasRoles.givePermissionTo(user, "publish-article");
        expect(HasRoles.hasPermissionTo(user, "publish-article")).toBe(true);

        HasRoles.revokePermissionTo(user, "publish-article");
        expect(HasRoles.hasPermissionTo(user, "publish-article")).toBe(false);
    });

    test("TemplateEngine compiles @role and @can directives correctly", () => {
        const engine = new TemplateEngine();

        const adminUser = new TestUser(1, "Admin", ["admin"], ["create-users"]);
        const regularUser = new TestUser(2, "John", ["user"]);

        const template = `
            @role('admin')
                <p>Admin Area</p>
            @endrole
            @can('create-users')
                <button>Create User</button>
            @endcan
        `;

        // Direct compile check by replacing view directives
        const compiled = (engine as any).compileDirectives(template);

        const executor = new Function("user", "return `" + compiled + "`;");

        const adminResult = executor(adminUser);
        expect(adminResult).toContain("<p>Admin Area</p>");
        expect(adminResult).toContain("<button>Create User</button>");

        const userResult = executor(regularUser);
        expect(userResult).not.toContain("<p>Admin Area</p>");
        expect(userResult).not.toContain("<button>Create User</button>");
    });
});
