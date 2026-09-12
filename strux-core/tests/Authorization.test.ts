import { describe, test, expect, beforeEach } from "vitest";
import { Gate, AuthorizationError, HasRoles, TemplateEngine, Auth, JwtGuard, BaseModel, Schema, CanMiddleware, RoleMiddleware, PermissionMiddleware, can, role, permission } from "../src/index.js";
import { httpContextStorage } from "../src/core/http/HttpContext.js";

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

    describe("Authorization with JWT and Middleware", () => {
        class AuthUserMock extends BaseModel {
            public table = "auth_users_gate_test";
            public id!: number;
            public name!: string;
            public roles!: string[];
            public permissions!: string[];
        }

        let adminToken: string;
        let userToken: string;

        beforeEach(async () => {
            await BaseModel.bootConnection({
                client: "sqlite3",
                connection: { filename: ":memory:" },
                useNullAsDefault: true,
            });

            await Schema.dropTableIfExists("auth_users_gate_test");
            await Schema.create("auth_users_gate_test", (table) => {
                table.integer("id").primary();
                table.string("name");
                table.json("roles");
                table.json("permissions");
            });

            await BaseModel.connection()("auth_users_gate_test").insert([
                { id: 1, name: "Admin", roles: JSON.stringify(["admin"]), permissions: JSON.stringify(["delete-post", "manage-users"]) },
                { id: 2, name: "User", roles: JSON.stringify(["user"]), permissions: JSON.stringify(["create-post"]) },
            ]);

            Auth.extend("api", AuthUserMock);
            Auth.configureJwt({
                secret: "super-secret-authorization-jwt-test-key",
                ttl: 3600,
            });

            const adminModel = new AuthUserMock();
            (adminModel as any).id = 1;
            adminToken = JwtGuard.issueToken(adminModel, "api");

            const userModel = new AuthUserMock();
            (userModel as any).id = 2;
            userToken = JwtGuard.issueToken(userModel, "api");
        });

        test("Gate.allows() automatically resolves user from JWT Bearer token", async () => {
            Gate.define("manage-users", (user) => {
                return user && HasRoles.hasRole(user, "admin");
            });

            // Admin token request context
            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: {} as any,
                    userCache: new Map(),
                },
                async () => {
                    expect(await Gate.allows("manage-users")).toBe(true);
                    expect(await Gate.denies("manage-users")).toBe(false);
                }
            );

            // Regular user token request context
            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: {} as any,
                    userCache: new Map(),
                },
                async () => {
                    expect(await Gate.allows("manage-users")).toBe(false);
                    expect(await Gate.denies("manage-users")).toBe(true);
                }
            );
        });

        test("Gate.authorize() succeeds for authorized JWT user and throws for unauthorized", async () => {
            Gate.define("manage-users", (user) => {
                return user && HasRoles.hasRole(user, "admin");
            });

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: {} as any,
                    userCache: new Map(),
                },
                async () => {
                    await expect(Gate.authorize("manage-users")).resolves.toBe(true);
                }
            );

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: {} as any,
                    userCache: new Map(),
                },
                async () => {
                    await expect(Gate.authorize("manage-users")).rejects.toThrow(AuthorizationError);
                }
            );
        });

        test("RoleMiddleware works seamlessly with JWT Bearer token", async () => {
            const roleMiddleware = new RoleMiddleware();

            // Admin user accessing role:admin
            let adminStatus = 200;
            let adminBody: any = null;
            const mockAdminReply = {
                status(code: number) {
                    adminStatus = code;
                    return this;
                },
                send(data: any) {
                    adminBody = data;
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: mockAdminReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await roleMiddleware.handle(
                        { headers: { authorization: `Bearer ${adminToken}` } } as any,
                        mockAdminReply as any,
                        "admin"
                    );
                    expect(adminStatus).toBe(200);
                    expect(adminBody).toBeNull();
                }
            );

            // Regular user accessing role:admin -> must be rejected with 403
            let userStatus = 200;
            let userBody: any = null;
            const mockUserReply = {
                status(code: number) {
                    userStatus = code;
                    return this;
                },
                send(data: any) {
                    userBody = data;
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: mockUserReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await roleMiddleware.handle(
                        { headers: { authorization: `Bearer ${userToken}` } } as any,
                        mockUserReply as any,
                        "admin"
                    );
                    expect(userStatus).toBe(403);
                    expect(userBody.statusCode).toBe(403);
                    expect(userBody.message).toContain("Requires one of the following roles: [admin]");
                }
            );
        });

        test("CanMiddleware works seamlessly with JWT Bearer token", async () => {
            const canMiddleware = new CanMiddleware();

            Gate.define("create-post", (user) => {
                return user && HasRoles.hasRole(user, "user");
            });

            let userStatus = 200;
            let userBody: any = null;
            const mockUserReply = {
                status(code: number) {
                    userStatus = code;
                    return this;
                },
                send(data: any) {
                    userBody = data;
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: mockUserReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await canMiddleware.handle(
                        { headers: { authorization: `Bearer ${userToken}` } } as any,
                        mockUserReply as any,
                        "create-post"
                    );
                    expect(userStatus).toBe(200);
                    expect(userBody).toBeNull();
                }
            );

            // Test unauthorized ability
            let forbiddenStatus = 200;
            let forbiddenBody: any = null;
            const mockForbiddenReply = {
                status(code: number) {
                    forbiddenStatus = code;
                    return this;
                },
                send(data: any) {
                    forbiddenBody = data;
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: mockForbiddenReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await canMiddleware.handle(
                        { headers: { authorization: `Bearer ${userToken}` } } as any,
                        mockForbiddenReply as any,
                        "non-existent-ability"
                    );
                    expect(forbiddenStatus).toBe(403);
                    expect(forbiddenBody.message).toContain("unauthorized");
                }
            );
        });

        test("PermissionMiddleware works seamlessly with JWT Bearer token", async () => {
            const permissionMiddleware = new PermissionMiddleware();

            let adminStatus = 200;
            const mockAdminReply = {
                status(code: number) {
                    adminStatus = code;
                    return this;
                },
                send(data: any) {
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: mockAdminReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await permissionMiddleware.handle(
                        { headers: { authorization: `Bearer ${adminToken}` } } as any,
                        mockAdminReply as any,
                        "delete-post"
                    );
                    expect(adminStatus).toBe(200);
                }
            );
        });

        test("Auth.user() resolves JWT user automatically when no session is present", async () => {
            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: {} as any,
                    userCache: new Map(),
                },
                async () => {
                    const user = await Auth.user<AuthUserMock>("api");
                    expect(user).not.toBeNull();
                    expect(user?.id).toBe(1);
                    expect(user?.name).toBe("Admin");
                }
            );
        });

        test("CanMiddleware, RoleMiddleware, PermissionMiddleware work with constructor instances and helpers", async () => {
            Gate.define("edit-post", (user) => {
                return user && HasRoles.hasRole(user, "admin");
            });

            // 1. CanMiddleware instance & can() helper
            const canInstance = new CanMiddleware("edit-post");
            const canHelper = can("edit-post");
            expect(canInstance.toString()).toBe("can:edit-post");
            expect(canHelper.toString()).toBe("can:edit-post");

            let canStatus = 200;
            const mockReply = {
                status(code: number) {
                    canStatus = code;
                    return this;
                },
                send() {
                    return this;
                }
            };

            // Allowed for admin
            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: mockReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await canInstance.handle({ headers: { authorization: `Bearer ${adminToken}` } } as any, mockReply as any);
                    expect(canStatus).toBe(200);

                    await canHelper.handle({ headers: { authorization: `Bearer ${adminToken}` } } as any, mockReply as any);
                    expect(canStatus).toBe(200);
                }
            );

            // Denied for regular user (403)
            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: mockReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await canInstance.handle({ headers: { authorization: `Bearer ${userToken}` } } as any, mockReply as any);
                    expect(canStatus).toBe(403);
                }
            );

            // 2. RoleMiddleware instance & role() helper
            const roleInstance = new RoleMiddleware("admin");
            const roleHelper = role("admin", "editor");
            expect(roleInstance.toString()).toBe("role:admin");
            expect(roleHelper.toString()).toBe("role:admin,editor");

            let roleStatus = 200;
            const mockRoleReply = {
                status(code: number) {
                    roleStatus = code;
                    return this;
                },
                send() {
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${userToken}` } } as any,
                    reply: mockRoleReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await roleInstance.handle({ headers: { authorization: `Bearer ${userToken}` } } as any, mockRoleReply as any);
                    expect(roleStatus).toBe(403);
                }
            );

            // 3. PermissionMiddleware instance & permission() helper
            const permInstance = new PermissionMiddleware("delete-post");
            const permHelper = permission("publish-post", "delete-post");
            expect(permInstance.toString()).toBe("permission:delete-post");
            expect(permHelper.toString()).toBe("permission:publish-post,delete-post");

            let permStatus = 200;
            const mockPermReply = {
                status(code: number) {
                    permStatus = code;
                    return this;
                },
                send() {
                    return this;
                }
            };

            await httpContextStorage.run(
                {
                    request: { headers: { authorization: `Bearer ${adminToken}` } } as any,
                    reply: mockPermReply as any,
                    userCache: new Map(),
                },
                async () => {
                    await permInstance.handle({ headers: { authorization: `Bearer ${adminToken}` } } as any, mockPermReply as any);
                    expect(permStatus).toBe(200);
                }
            );
        });
    });
});
