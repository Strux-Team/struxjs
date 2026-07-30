import { BaseModel } from "../BaseModel.js";
import { Relation } from "./Relation.js";

function getModelName(model: BaseModel): string {
    if (!model) return "model";
    const rawName = model.constructor?.name;
    if (rawName && rawName !== "Object" && rawName !== "BaseModel") {
        return rawName.toLowerCase();
    }
    const protoName = Object.getPrototypeOf(model)?.constructor?.name;
    if (protoName && protoName !== "Object" && protoName !== "BaseModel") {
        return protoName.toLowerCase();
    }
    const table = (model as any).table;
    if (typeof table === "string" && table) {
        return table.endsWith("s") ? table.slice(0, -1) : table;
    }
    return "model";
}

export class HasMany extends Relation {
    constructor(
        parent: BaseModel,
        related: new (attrs?: Record<string, any>) => BaseModel,
        foreignKey?: string,
        localKey?: string
    ) {
        const dummyParent = parent;
        const defaultForeignKey = `${getModelName(dummyParent)}_id`;
        const defaultLocalKey = (dummyParent as any).primaryKey || "id";

        super(
            parent,
            related,
            foreignKey || defaultForeignKey,
            localKey || defaultLocalKey,
            "hasMany"
        );
    }

    public query() {
        const pkVal = (this.parent as any).attributes?.[this.localKey] ?? (this.parent as any)[this.localKey];
        return (this.related as any).where(this.foreignKey, pkVal);
    }

    public async create(attributes: Record<string, any> = {}): Promise<any> {
        const pkVal = (this.parent as any).attributes?.[this.localKey] ?? (this.parent as any)[this.localKey];
        if (!pkVal) {
            throw new Error(`[StruxJS ORM Error]: Cannot create relation on unsaved parent model.`);
        }
        const mergedData = { ...attributes, [this.foreignKey]: pkVal };
        return await (this.related as any).create(mergedData);
    }

    public async createMany(records: Record<string, any>[]): Promise<any[]> {
        const results: any[] = [];
        for (const record of records) {
            results.push(await this.create(record));
        }
        return results;
    }

    public async save(model: BaseModel): Promise<BaseModel> {
        const pkVal = (this.parent as any).attributes?.[this.localKey] ?? (this.parent as any)[this.localKey];
        if (!pkVal) {
            throw new Error(`[StruxJS ORM Error]: Cannot save relation on unsaved parent model.`);
        }
        (model as any).attributes[this.foreignKey] = pkVal;
        await model.save();
        return model;
    }

    public async saveMany(models: BaseModel[]): Promise<BaseModel[]> {
        const results: BaseModel[] = [];
        for (const model of models) {
            results.push(await this.save(model));
        }
        return results;
    }

    public async getEager(models: BaseModel[]): Promise<BaseModel[]> {
        const keys = Array.from(new Set(models.map((model: any) => model.attributes?.[this.localKey] ?? model[this.localKey]).filter(k => k !== undefined && k !== null)));
        if (keys.length === 0) return [];

        const relatedModel = this.related as any;
        return await relatedModel.whereIn(this.foreignKey, keys).get();
    }

    public match(models: BaseModel[], results: BaseModel[], relationName: string): void {
        const resultMap = new Map<string, BaseModel[]>();
        results.forEach((res: any) => {
            const fkVal = res.attributes?.[this.foreignKey] ?? res[this.foreignKey];
            if (fkVal !== undefined && fkVal !== null) {
                const keyStr = String(fkVal);
                if (!resultMap.has(keyStr)) {
                    resultMap.set(keyStr, []);
                }
                resultMap.get(keyStr)!.push(res);
            }
        });

        models.forEach((model: any) => {
            const pkVal = model.attributes?.[this.localKey] ?? model[this.localKey];
            const matches = pkVal !== undefined && pkVal !== null ? (resultMap.get(String(pkVal)) || []) : [];
            model.setRelation(relationName, matches);
        });
    }
}
