import { BaseModel } from "../BaseModel.js";
import { QueryBuilder } from "../QueryBuilder.js";

export abstract class Relation {
    constructor(
        public parent: BaseModel,
        public related: new (attrs?: Record<string, any>) => BaseModel,
        public foreignKey: string,
        public localKey: string,
        public relationType: "hasOne" | "hasMany" | "belongsTo" | "belongsToMany",
        public pivotTable?: string,
        public relatedPivotKey?: string
    ) {
        return new Proxy(this, {
            get(target: any, prop: string | symbol, receiver: any) {
                if (prop in target) {
                    return Reflect.get(target, prop, receiver);
                }
                const builder = target.query();
                if (prop in builder || typeof builder[prop] === "function") {
                    const value = builder[prop];
                    return typeof value === "function" ? value.bind(builder) : value;
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    public abstract query(): QueryBuilder<any>;

    public async get(): Promise<any> {
        return this.query().get();
    }

    public async first(): Promise<any> {
        return this.query().first();
    }

    public where(column: string | Record<string, any>, operator?: any, value?: any): QueryBuilder<any> {
        return this.query().where(column, operator, value);
    }

    public abstract match(models: BaseModel[], results: BaseModel[], relationName: string): void;
    public abstract getEager(models: BaseModel[]): Promise<BaseModel[]>;
}
