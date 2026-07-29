import { Schema, Blueprint } from "struxjs";

export default {
    async up() {
        await Schema.create("users", (table: Blueprint) => {
            table.id();
            table.string('name').nullable();
            table.string('email').unique();
            table.string('password').nullable();
            table.timestamps();
        });
    },

    async down() {
        await Schema.dropIfExists("users");
    }
};
