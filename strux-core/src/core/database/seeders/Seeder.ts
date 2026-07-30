import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export abstract class Seeder {
    /**
     * Run the database seeds.
     */
    public abstract run(): Promise<void>;

    /**
     * Run additional seeders from within a seeder.
     */
    public async call(seeders: any[]): Promise<void> {
        for (const SeederItem of seeders) {
            let instance: Seeder;

            if (typeof SeederItem === "function") {
                instance = new SeederItem();
            } else if (typeof SeederItem === "string") {
                const seederPath = path.join(process.cwd(), "database", "seeders", `${SeederItem}.ts`);
                const jsSeederPath = path.join(process.cwd(), "database", "seeders", `${SeederItem}.js`);
                
                let targetPath = seederPath;
                if (!fs.existsSync(seederPath) && fs.existsSync(jsSeederPath)) {
                    targetPath = jsSeederPath;
                }

                const module = await import(pathToFileURL(targetPath).href);
                const TargetClass = module.default || module[SeederItem] || module;
                instance = new TargetClass();
            } else {
                instance = SeederItem;
            }

            console.log(`  Seeding: \x1b[36m${instance.constructor.name}\x1b[0m`);
            const start = Date.now();
            await instance.run();
            const time = Date.now() - start;
            console.log(`  \x1b[32mSeeded:\x1b[0m  ${instance.constructor.name} (${time}ms)`);
        }
    }
}
