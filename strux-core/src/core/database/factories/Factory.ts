import fs from "fs";
import path from "path";
import { faker, Faker } from "@faker-js/faker";
import { BaseModel } from "../BaseModel.js";
import { collect, Collection } from "../EloquentBuilder.js";

export abstract class Factory<T extends BaseModel> {
    protected model!: new () => T;
    public faker: Faker = faker;
    private countNum: number = 1;

    /**
     * Define the model's default state attributes
     */
    public abstract definition(): Record<string, any>;

    /**
     * Create a new instance of the factory builder
     */
    public static new<F extends Factory<any>>(this: new () => F): F {
        return new this();
    }

    /**
     * Specify how many models the factory should generate
     */
    public count(count: number): this {
        this.countNum = Math.max(1, count);
        return this;
    }

    /**
     * Create unsaved model instances (Laravel make())
     */
    public make(attributes: Record<string, any> = {}): T | Collection<T> {
        const instances: T[] = [];

        for (let i = 0; i < this.countNum; i++) {
            const defData = this.definition();
            const merged = { ...defData, ...attributes };

            const instance = new this.model();
            Object.assign(instance, merged);
            instances.push(instance);
        }

        return this.countNum === 1 ? instances[0] : (collect(instances) as any);
    }

    /**
     * Create and persist model instances into database (Laravel create())
     */
    public async create(attributes: Record<string, any> = {}): Promise<T | Collection<T>> {
        const persisted: T[] = [];

        for (let i = 0; i < this.countNum; i++) {
            const defData = this.definition();
            const merged = { ...defData, ...attributes };

            const ModelClass = this.model as any;
            const modelInstance = await ModelClass.create(merged);
            persisted.push(modelInstance);
        }

        return this.countNum === 1 ? persisted[0] : (collect(persisted) as any);
    }

    /**
     * Generate a new Factory file template
     */
    public static makeFactory(name: string, customDir?: string): string {
        const factoriesDir = customDir || path.join(process.cwd(), "database", "factories");
        if (!fs.existsSync(factoriesDir)) {
            fs.mkdirSync(factoriesDir, { recursive: true });
        }

        const cleanName = name.endsWith("Factory") ? name : `${name}Factory`;
        const modelName = cleanName.replace(/Factory$/, "");
        const filePath = path.join(factoriesDir, `${cleanName}.ts`);

        const content = `import { Factory } from "struxjs";
import { ${modelName} } from "../../app/Models/${modelName}.ts";

export class ${cleanName} extends Factory<${modelName}> {
    protected model = ${modelName};

    /**
     * Define the model's default state.
     */
    public definition(): Record<string, any> {
        return {
            name: this.faker.person.fullName(),
            email: this.faker.internet.email(),
            status: true
        };
    }
}
`;

        fs.writeFileSync(filePath, content, "utf8");
        return filePath;
    }
}
