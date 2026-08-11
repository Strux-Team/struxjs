import "./bootstrap-cli.js";
import { User } from "./app/Models/User.js";
import { validatePayload } from "struxjs";

async function run() {
    console.log("Booting StruxJS...");

    console.log("\n--- TEST: Nested Validation ---");
    const payload = {
        users: [
            { email: "john@test.com", age: 20 },
            { email: "invalid", age: 10 }
        ]
    };
    try {
        await validatePayload(payload, {
            'users.*.email': 'required|email',
            'users.*.age': 'required|numeric|min:18'
        });
        console.log("❌ Validation bypassed? (This is bad)");
    } catch (e: any) {
        console.log("✅ Validation failed as expected for invalid email and age < 18!");
        console.log("Errors:", e.errors);
    }

    const payload2 = {
        users: [
            { email: "john@test.com", age: 20 },
            { email: "bob@test.com", age: 25 }
        ]
    };
    try {
        const validated = await validatePayload(payload2, {
            'users.*.email': 'required|email',
            'users.*.age': 'required|numeric|min:18'
        });
        console.log("✅ Validation passed as expected!");
        console.log("Validated Data:", JSON.stringify(validated, null, 2));
    } catch (e: any) {
        console.log("❌ Validation failed? (This is bad)", e);
    }

    // Check if we have users
    const userCount = await User.count();
    if (userCount === 0) {
        console.log("\nNo users in DB, creating some mock users...");
        for (let i = 1; i <= 5; i++) {
            await User.create({ name: `User ${i}`, email: `user${i}@example.com`, password: 'password' });
        }
    } else {
        console.log(`\nFound ${userCount} users in DB, proceeding with DB tests...`);
    }

    console.log("\n--- TEST: Chunk ---");
    let chunkCount = 0;
    await User.chunk(2, async (users, page) => {
        chunkCount++;
        console.log(`Chunk ${page}: ${users.count()} users`);
    });
    console.log(`✅ Total chunks: ${chunkCount}`);

    console.log("\n--- TEST: Lazy ---");
    let lazyCount = 0;
    for await (const user of User.lazy(2)) {
        lazyCount++;
        console.log(`Lazy user: ${user.name}`);
    }
    console.log(`✅ Total lazy items: ${lazyCount}`);

    console.log("\n--- TEST: Cursor Pagination ---");
    console.log("Page 1:");
    const page1 = await User.cursorPaginate(2, 'id', 'asc');
    console.log("Data:", page1.all().map((u: any) => u.name));
    console.log("Next Cursor:", page1.nextCursor);
    console.log("Next URL:", page1.nextPageUrl());

    if (page1.nextCursor) {
        console.log("\nPage 2:");
        const page2 = await User.cursorPaginate(2, 'id', 'asc', page1.nextCursor);
        console.log("Data:", page2.all().map((u: any) => u.name));
        console.log("Next Cursor:", page2.nextCursor);
    }
    
    console.log("\n✅ ALL TESTS COMPLETED!");
    process.exit(0);
}

run();
