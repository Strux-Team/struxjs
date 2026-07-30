import { BaseModel } from "../BaseModel.js";
import { Relation } from "./Relation.js";

function getConstructorName(relatedClass: any): string {
    if (!relatedClass) return "related";
    const name = relatedClass.name;
    if (name && name !== "Object" && name !== "BaseModel") {
        return name.toLowerCase();
    }
    const dummy = new relatedClass();
    const table = (dummy as any).table;
    if (typeof table === "string" && table) {
        return table.endsWith("s") ? table.slice(0, -1) : table;
    }
    return "related";
}

export class BelongsTo extends Relation {
    constructor(
        parent: BaseModel,
        related: new (attrs?: Record<string, any>) => BaseModel,
        foreignKey?: string,
        ownerKey?: string
    ) {
        const dummyRelated = new related();
        const defaultForeignKey = `${getConstructorName(related)}_id`;
        const defaultOwnerKey = (dummyRelated as any).primaryKey || "id";

        super(
            parent,
            related,
            foreignKey || defaultForeignKey,
            ownerKey || defaultOwnerKey,
            "belongsTo"
        );
    }

    public query() {
        const fkVal = (this.parent as any).attributes?.[this.foreignKey] ?? (this.parent as any)[this.foreignKey];
        return (this.related as any).where(this.localKey, fkVal);
    }

    public async get(): Promise<any> {
        return this.query().first();
    }

    public async getEager(models: BaseModel[]): Promise<BaseModel[]> {
        const keys = Array.from(new Set(models.map((model: any) => model.attributes?.[this.foreignKey] ?? model[this.foreignKey]).filter(k => k !== undefined && k !== null)));
        if (keys.length === 0) return [];

        const relatedModel = this.related as any;
        return await relatedModel.whereIn(this.localKey, keys).get();
    }

    public match(models: BaseModel[], results: BaseModel[], relationName: string): void {
        const resultMap = new Map<string, BaseModel>();
        results.forEach((res: any) => {
            const ownerVal = res.attributes?.[this.localKey] ?? res[this.localKey];
            if (ownerVal !== undefined && ownerVal !== null) {
                resultMap.set(String(ownerVal), res);
            }
        });

        models.forEach((model: any) => {
            const fkVal = model.attributes?.[this.foreignKey] ?? model[this.foreignKey];
            const match = fkVal !== undefined && fkVal !== null ? (resultMap.get(String(fkVal)) || null) : null;
            model.setRelation(relationName, match);
        });
    }
}
