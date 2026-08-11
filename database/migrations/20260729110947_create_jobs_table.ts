import { Schema, TableBuilder } from "struxjs";

export async function up(): Promise<void> {
    await Schema.create("jobs", (table: TableBuilder) => {
        table.string("id", 36).primary();
        table.string("queue", 255).notNullable().defaultTo("default").index();
        table.text("payload").notNullable();
        table.integer("attempts").notNullable().defaultTo(0);
        table.bigInteger("available_at").notNullable().index();
        table.bigInteger("reserved_at").nullable().defaultTo(null);
        table.bigInteger("created_at").notNullable();
    });
}

export async function down(): Promise<void> {
    await Schema.dropIfExists("jobs");
}
