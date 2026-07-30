import { Schema, Blueprint } from "struxjs";

export async function up(): Promise<void> {
    await Schema.create("failed_jobs", (table: Blueprint) => {
        table.string("id", 36).primary();
        table.string("queue", 255).notNullable().index();
        table.text("payload").notNullable();
        table.bigInteger("failed_at").notNullable().index();
    });
}

export async function down(): Promise<void> {
    await Schema.dropIfExists("failed_jobs");
}
