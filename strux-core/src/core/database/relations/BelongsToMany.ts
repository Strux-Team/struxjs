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

export class BelongsToMany extends Relation {
    public parentKey: string;
    public relatedKey: string;

    constructor(
        parent: BaseModel,
        related: new (attrs?: Record<string, any>) => BaseModel,
        pivotTable?: string,
        foreignPivotKey?: string,
        relatedPivotKey?: string,
        parentKey?: string,
        relatedKey?: string
    ) {
        const dummyParent = parent;
        const dummyRelated = new related();

        const parentName = getModelName(dummyParent);
        const relatedName = getModelName(dummyRelated);

        const defaultPivotTable = [parentName, relatedName].sort().join("_");
        const defaultForeignPivotKey = `${parentName}_id`;
        const defaultRelatedPivotKey = `${relatedName}_id`;

        const defaultParentKey = (dummyParent as any).primaryKey || "id";
        const defaultRelatedKey = (dummyRelated as any).primaryKey || "id";

        super(
            parent,
            related,
            foreignPivotKey || defaultForeignPivotKey,
            parentKey || defaultParentKey,
            "belongsToMany",
            pivotTable || defaultPivotTable,
            relatedPivotKey || defaultRelatedPivotKey
        );

        this.parentKey = parentKey || defaultParentKey;
        this.relatedKey = relatedKey || defaultRelatedKey;
    }

    public query() {
        const pkVal = (this.parent as any).attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        const relatedDummy = new this.related();
        const relatedTable = (relatedDummy as any).table || `${relatedDummy.constructor.name.toLowerCase()}s`;

        const builder = (this.related as any).query();
        if (builder.driver === "sql") {
            builder.getKnexQuery()
                .join(this.pivotTable!, `${relatedTable}.${this.relatedKey}`, "=", `${this.pivotTable!}.${this.relatedPivotKey!}`)
                .where(`${this.pivotTable!}.${this.foreignKey}`, pkVal)
                .select(`${relatedTable}.*`);
        }
        return builder;
    }

    public async getEager(models: BaseModel[]): Promise<BaseModel[]> {
        const parentKeys = Array.from(
            new Set(
                models
                    .map((model: any) => model.attributes?.[this.parentKey] ?? model[this.parentKey])
                    .filter(k => k !== undefined && k !== null)
            )
        );

        if (parentKeys.length === 0) return [];

        const relatedDummy = new this.related();
        const relatedTable = (relatedDummy as any).table || `${relatedDummy.constructor.name.toLowerCase()}s`;
        const db = BaseModel.connection();

        // Perform JOIN query between related table and pivot table
        const rows = await db(relatedTable)
            .join(this.pivotTable!, `${relatedTable}.${this.relatedKey}`, "=", `${this.pivotTable!}.${this.relatedPivotKey!}`)
            .whereIn(`${this.pivotTable!}.${this.foreignKey}`, parentKeys)
            .select(`${relatedTable}.*`, `${this.pivotTable!}.${this.foreignKey} as _pivot_${this.foreignKey}`);

        return rows.map((row: any) => {
            const pivotFk = row[`_pivot_${this.foreignKey}`];
            delete row[`_pivot_${this.foreignKey}`];
            const instance = new this.related(row);
            (instance as any)._pivot_fk = pivotFk;
            return instance;
        });
    }

    public match(models: BaseModel[], results: BaseModel[], relationName: string): void {
        const resultMap = new Map<string, BaseModel[]>();

        results.forEach((res: any) => {
            const pivotFk = res._pivot_fk;
            if (pivotFk !== undefined && pivotFk !== null) {
                const keyStr = String(pivotFk);
                if (!resultMap.has(keyStr)) {
                    resultMap.set(keyStr, []);
                }
                resultMap.get(keyStr)!.push(res);
            }
        });

        models.forEach((model: any) => {
            const pkVal = model.attributes?.[this.parentKey] ?? model[this.parentKey];
            const matches = pkVal !== undefined && pkVal !== null ? (resultMap.get(String(pkVal)) || []) : [];
            model.setRelation(relationName, matches);
        });
    }

    /* -------------------------------------------------------------------------- */
    /*                         PIVOT MUTATION METHODS                             */
    /* -------------------------------------------------------------------------- */

    /**
     * Create a new instance of the related model and attach it to the pivot table
     */
    public async create(attributes: Record<string, any> = {}, pivotAttributes: Record<string, any> = {}): Promise<any> {
        const parentId = this.parent.attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        if (!parentId) {
            throw new Error(`[StruxJS ORM Error]: Cannot create relation on unsaved parent model.`);
        }

        const newModel = await (this.related as any).create(attributes);
        const relatedId = newModel.attributes?.[this.relatedKey] ?? newModel[this.relatedKey];

        await this.attach(relatedId, pivotAttributes);
        return newModel;
    }

    public async createMany(records: Array<{ attributes: Record<string, any>; pivot?: Record<string, any> } | Record<string, any>>): Promise<any[]> {
        const results: any[] = [];
        for (const item of records) {
            if (item && typeof item === "object" && ("attributes" in item || "pivot" in item)) {
                results.push(await this.create((item as any).attributes || {}, (item as any).pivot || {}));
            } else {
                results.push(await this.create(item));
            }
        }
        return results;
    }

    /**
     * Attach a related model or ID to the pivot table
     */
    public async attach(ids: any | any[], attributes: Record<string, any> = {}): Promise<void> {
        const parentId = this.parent.attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        if (!parentId) {
            throw new Error(`[StruxJS ORM Error]: Cannot attach relation to unsaved parent model.`);
        }

        const idList = Array.isArray(ids) ? ids : [ids];
        const db = BaseModel.connection();

        const rowsToInsert = idList.map(id => {
            const targetId = typeof id === "object" ? (id.attributes?.[this.relatedKey] ?? id[this.relatedKey]) : id;
            return {
                [this.foreignKey]: parentId,
                [this.relatedPivotKey!]: targetId,
                ...attributes
            };
        });

        await db(this.pivotTable!).insert(rowsToInsert);
    }

    /**
     * Detach related models or IDs from the pivot table
     */
    public async detach(ids?: any | any[]): Promise<number> {
        const parentId = this.parent.attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        if (!parentId) return 0;

        const db = BaseModel.connection();
        let query = db(this.pivotTable!).where(this.foreignKey, parentId);

        if (ids !== undefined) {
            const idList = Array.isArray(ids) ? ids : [ids];
            const cleanIds = idList.map(id => typeof id === "object" ? (id.attributes?.[this.relatedKey] ?? id[this.relatedKey]) : id);
            query = query.whereIn(this.relatedPivotKey!, cleanIds);
        }

        return await query.delete();
    }

    /**
     * Sync related IDs in the pivot table (detach missing and attach new)
     */
    public async sync(ids: any[]): Promise<{ attached: any[]; detached: number }> {
        const parentId = this.parent.attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        if (!parentId) {
            throw new Error(`[StruxJS ORM Error]: Cannot sync relations on unsaved parent model.`);
        }

        const db = BaseModel.connection();
        const targetIds = ids.map(id => typeof id === "object" ? (id.attributes?.[this.relatedKey] ?? id[this.relatedKey]) : id);

        // Fetch current attached IDs
        const existingRows = await db(this.pivotTable!)
            .where(this.foreignKey, parentId)
            .select(this.relatedPivotKey!);

        const existingIds = existingRows.map((r: any) => r[this.relatedPivotKey!]);

        const toAttach = targetIds.filter(id => !existingIds.includes(id));
        const toDetach = existingIds.filter(id => !targetIds.includes(id));

        let detachedCount = 0;
        if (toDetach.length > 0) {
            detachedCount = await this.detach(toDetach);
        }

        if (toAttach.length > 0) {
            await this.attach(toAttach);
        }

        return { attached: toAttach, detached: detachedCount };
    }

    /**
     * Toggle related IDs in the pivot table (attach if missing, detach if present)
     */
    public async toggle(ids: any | any[]): Promise<{ attached: any[]; detached: number }> {
        const parentId = this.parent.attributes?.[this.parentKey] ?? (this.parent as any)[this.parentKey];
        if (!parentId) {
            throw new Error(`[StruxJS ORM Error]: Cannot toggle relations on unsaved parent model.`);
        }

        const idList = Array.isArray(ids) ? ids : [ids];
        const targetIds = idList.map(id => typeof id === "object" ? (id.attributes?.[this.relatedKey] ?? id[this.relatedKey]) : id);

        const db = BaseModel.connection();
        const existingRows = await db(this.pivotTable!)
            .where(this.foreignKey, parentId)
            .select(this.relatedPivotKey!);

        const existingIds = existingRows.map((r: any) => r[this.relatedPivotKey!]);

        const toAttach = targetIds.filter(id => !existingIds.includes(id));
        const toDetach = targetIds.filter(id => existingIds.includes(id));

        let detachedCount = 0;
        if (toDetach.length > 0) {
            detachedCount = await this.detach(toDetach);
        }

        if (toAttach.length > 0) {
            await this.attach(toAttach);
        }

        return { attached: toAttach, detached: detachedCount };
    }
}
