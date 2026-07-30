import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export class SeederRunner {
    private seedersDir: string;

    constructor(customDir?: string) {
        this.seedersDir = customDir || path.join(process.cwd(), "database", "seeders");
    }

    /**
     * Execute seeders (Defaults to DatabaseSeeder)
     */
    public async run(className = "DatabaseSeeder"): Promise<void> {
        const tsPath = path.join(this.seedersDir, `${className}.ts`);
        const jsPath = path.join(this.seedersDir, `${className}.js`);

        let targetFile = "";
        if (fs.existsSync(tsPath)) {
            targetFile = tsPath;
        } else if (fs.existsSync(jsPath)) {
            targetFile = jsPath;
        } else {
            console.error(`\x1b[31m[StruxJS Error]: Seeder file '${className}' not found in database/seeders/\x1b[0m`);
            return;
        }

        console.log(`\n\x1b[34mRunning database seeders...\x1b[0m`);
        const module = await import(pathToFileURL(targetFile).href);
        const SeederClass = module.default || module[className] || module;

        if (typeof SeederClass !== "function") {
            console.error(`\x1b[31m[StruxJS Error]: Seeder '${className}' must export a default Seeder class.\x1b[0m`);
            return;
        }

        const instance = new SeederClass();
        console.log(`  Seeding: \x1b[36m${className}\x1b[0m`);
        const start = Date.now();
        await instance.run();
        const time = Date.now() - start;
        console.log(`  \x1b[32mSeeded:\x1b[0m  ${className} (${time}ms)`);
        console.log(`\x1b[32mDatabase seeding completed successfully.\x1b[0m\n`);
    }

    /**
     * Create a new Seeder class file
     */
    public static make(name: string, customDir?: string): string {
        const seedersDir = customDir || path.join(process.cwd(), "database", "seeders");
        if (!fs.existsSync(seedersDir)) {
            fs.mkdirSync(seedersDir, { recursive: true });
        }

        const cleanName = name.endsWith("Seeder") ? name : `${name}Seeder`;
        const filePath = path.join(seedersDir, `${cleanName}.ts`);

        const content = `import { Seeder } from "struxjs";

export default class ${cleanName} extends Seeder {
    /**
     * Run the database seeds.
     */
    public async run(): Promise<void> {
        // Write your seeding logic here, e.g.:
        // await User.create({ name: "Admin", email: "admin@example.com" });
    }
}
`;

        fs.writeFileSync(filePath, content, "utf8");
        return filePath;
    }
}
