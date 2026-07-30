import { describe, test, expect, beforeEach } from "vitest";
import { BaseModel, Schema, DB } from "../src/index.js";

class User extends BaseModel {
    public table = "users";
    public fillable = ["name", "email"];

    public posts() {
        return this.hasMany(Post, "user_id");
    }
}

class Post extends BaseModel {
    public table = "posts";
    public fillable = ["title", "content", "user_id"];

    public user() {
        return this.belongsTo(User, "user_id");
    }
}

describe("Active Record ORM & Query Builder", () => {
    beforeEach(async () => {
        await BaseModel.bootConnection({
            client: "sqlite3",
            connection: { filename: ":memory:" },
            useNullAsDefault: true,
        });

        await Schema.dropTableIfExists("posts");
        await Schema.dropTableIfExists("users");

        await Schema.create("users", (table) => {
            table.id();
            table.string("name");
            table.string("email");
            table.timestamps();
        });

        await Schema.create("posts", (table) => {
            table.id();
            table.integer("user_id").unsigned();
            table.string("title");
            table.text("content");
            table.timestamps();
        });
    });

    test("creates, finds, updates, and deletes records", async () => {
        const user = await User.create<User>({
            name: "John Active",
            email: "john@orm.com",
        });

        expect(user.id).toBeDefined();
        expect(user.attributes.name).toBe("John Active");

        const found = await User.find<User>(user.id);
        expect(found).not.toBeNull();
        expect(found!.attributes.email).toBe("john@orm.com");

        await found!.update({ name: "John Updated" });
        const updated = await User.find<User>(user.id);
        expect(updated!.attributes.name).toBe("John Updated");

        await updated!.delete();
        const deleted = await User.find<User>(user.id);
        expect(deleted).toBeNull();
    });

    test("paginates query results", async () => {
        for (let i = 1; i <= 15; i++) {
            await User.create({ name: `User ${i}`, email: `user${i}@test.com` });
        }

        const page1 = await User.paginate<User>(5, 1);
        expect(page1.data.all()).toHaveLength(5);
        expect(page1.total).toBe(15);
        expect(page1.lastPage).toBe(3);

        const page2 = await User.paginate<User>(5, 2);
        expect(page2.currentPage).toBe(2);
        expect(page2.data.all()[0].attributes.name).toBe("User 6");
    });

    test("resolves HasMany and BelongsTo relationships", async () => {
        const user = await User.create<User>({ name: "Author", email: "author@test.com" });
        await Post.create({ title: "Post 1", content: "Hello 1", user_id: user.id });
        await Post.create({ title: "Post 2", content: "Hello 2", user_id: user.id });

        const posts = await user.posts().get();
        expect(posts.all()).toHaveLength(2);
        expect(posts.all()[0].attributes.title).toBe("Post 1");

        const postInstance = posts.all()[0] as Post;
        const postUser = await postInstance.user().first();
        expect(postUser!.attributes.name).toBe("Author");
    });

    test("DB raw query builder works", async () => {
        await DB.table("users").insert({ name: "Raw User", email: "raw@test.com" });

        const count = await DB.table("users").count("id as total");
        expect(Number((count[0] as any).total)).toBe(1);
    });

    test("supports whereColumn query filters", async () => {
        await User.create({ name: "Same", email: "Same" });
        await User.create({ name: "Diff", email: "Other" });

        const matching = await User.whereColumn("name", "email").get();
        expect(matching.all()).toHaveLength(1);
        expect(matching.all()[0].attributes.name).toBe("Same");
    });

    test("supports aggregate functions and groupBy having clauses", async () => {
        await User.create({ name: "User A", email: "a@test.com" });
        await User.create({ name: "User B", email: "b@test.com" });

        expect(await User.count()).toBe(2);
        expect(await User.exists()).toBe(true);
        expect(await User.where("name", "NonExistent").doesntExist()).toBe(true);

        const groups = await User.query()
            .select("name")
            .groupBy("name")
            .having("name", "=", "User A")
            .get();

        expect(groups.all()).toHaveLength(1);
        expect(groups.all()[0].attributes.name).toBe("User A");
    });

    test("supports raw SQL facade and query builder methods", async () => {
        await DB.insert("INSERT INTO users (name, email) VALUES (?, ?)", ["Raw Insert", "insert@test.com"]);

        const selected = await DB.select("SELECT * FROM users WHERE email = ?", ["insert@test.com"]);
        expect(selected.all()).toHaveLength(1);
        expect(selected.first().name).toBe("Raw Insert");

        const updated = await DB.update("UPDATE users SET name = ? WHERE email = ?", ["Raw Updated", "insert@test.com"]);
        expect(updated).toBeGreaterThan(0);

        const rawList = await User.selectRaw("id, name")
            .whereRaw("email = ?", ["insert@test.com"])
            .orderByRaw("id DESC")
            .get();

        expect(rawList.all()).toHaveLength(1);
        expect(rawList.first().attributes.name).toBe("Raw Updated");

        const deleted = await DB.delete("DELETE FROM users WHERE email = ?", ["insert@test.com"]);
        expect(deleted).toBeGreaterThan(0);
    });
});
