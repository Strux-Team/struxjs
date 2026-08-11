import { Knex } from "knex";

export class TableBuilder {
    private tableBuilder: any;

    constructor(tableBuilder: any) {
        this.tableBuilder = tableBuilder;
    }

    /**
     * Attach Laravel-style .change() method onto ColumnBuilder instance
     */
    private wrapColumn(colBuilder: any): any {
        if (colBuilder && typeof colBuilder.alter === "function" && !colBuilder.change) {
            colBuilder.change = function () {
                return this.alter();
            };
        }
        return colBuilder;
    }

    /**
     * Primary key auto-increment ID
     */
    public id(column = "id"): Knex.ColumnBuilder {
        return this.tableBuilder.increments(column).primary();
    }

    /**
     * Big auto-increment primary key ID
     */
    public bigIncrements(column = "id"): Knex.ColumnBuilder {
        return this.tableBuilder.bigIncrements(column).primary();
    }

    /**
     * UUID primary key column
     */
    public uuid(column = "id"): Knex.ColumnBuilder {
        return this.tableBuilder.uuid(column);
    }

    /**
     * String column (VARCHAR)
     */
    public string(column: string, length = 255): any {
        return this.wrapColumn(this.tableBuilder.string(column, length));
    }

    /**
     * Text column
     */
    public text(column: string): any {
        return this.wrapColumn(this.tableBuilder.text(column));
    }

    /**
     * LongText column
     */
    public longText(column: string): any {
        return this.wrapColumn(this.tableBuilder.text(column, "longtext"));
    }

    /**
     * Integer column
     */
    public integer(column: string): any {
        return this.wrapColumn(this.tableBuilder.integer(column));
    }

    /**
     * Unsigned Integer column
     */
    public unsignedInteger(column: string): any {
        return this.wrapColumn(this.tableBuilder.integer(column).unsigned());
    }

    /**
     * BigInteger column
     */
    public bigInteger(column: string): any {
        return this.wrapColumn(this.tableBuilder.bigInteger(column));
    }

    /**
     * Float / Double column
     */
    public float(column: string, precision = 8, scale = 2): any {
        return this.wrapColumn(this.tableBuilder.float(column, precision, scale));
    }

    /**
     * Decimal column
     */
    public decimal(column: string, precision = 8, scale = 2): any {
        return this.wrapColumn(this.tableBuilder.decimal(column, precision, scale));
    }

    /**
     * Boolean column
     */
    public boolean(column: string): any {
        return this.wrapColumn(this.tableBuilder.boolean(column));
    }

    /**
     * Date column
     */
    public date(column: string): any {
        return this.wrapColumn(this.tableBuilder.date(column));
    }

    /**
     * DateTime column
     */
    public dateTime(column: string): any {
        return this.wrapColumn(this.tableBuilder.dateTime(column));
    }

    /**
     * Timestamp column
     */
    public timestamp(column: string): any {
        return this.wrapColumn(this.tableBuilder.timestamp(column));
    }

    /**
     * Add created_at and updated_at timestamp columns (Laravel style)
     */
    public timestamps(useTimestamps = true, defaultToNow = true): void {
        if (useTimestamps) {
            const created = this.tableBuilder.timestamp("created_at");
            const updated = this.tableBuilder.timestamp("updated_at");

            if (defaultToNow) {
                created.defaultTo(this.tableBuilder.client.raw("CURRENT_TIMESTAMP"));
                updated.defaultTo(this.tableBuilder.client.raw("CURRENT_TIMESTAMP"));
            }
        }
    }

    /**
     * Enum column (e.g. table.enum('role', ['admin', 'editor', 'user']))
     */
    public enum(column: string, allowedValues: string[]): any {
        return this.wrapColumn(this.tableBuilder.enum(column, allowedValues));
    }

    /**
     * Soft deletes column (deleted_at timestamp)
     */
    public softDeletes(column = "deleted_at"): any {
        return this.wrapColumn(this.tableBuilder.timestamp(column).nullable());
    }

    /**
     * TinyInteger column
     */
    public tinyInteger(column: string): any {
        return this.wrapColumn(this.tableBuilder.tinyint(column));
    }

    /**
     * SmallInteger column
     */
    public smallInteger(column: string): any {
        return this.wrapColumn(this.tableBuilder.smallint(column));
    }

    /**
     * JSON column
     */
    public json(column: string): any {
        return this.wrapColumn(this.tableBuilder.json(column));
    }

    /**
     * Binary BLOB column
     */
    public binary(column: string): any {
        return this.wrapColumn(this.tableBuilder.binary(column));
    }

    /**
     * Explicit Foreign key definition: table.foreign('user_id').references('id').on('users')
     */
    public foreign(column: string | string[]): ExplicitForeignBuilder {
        return new ExplicitForeignBuilder(this.tableBuilder, column);
    }

    /**
     * Laravel shortcut: foreignId('user_id').constrained('users').onDelete('cascade')
     */
    public foreignId(column: string): ForeignIdBuilder {
        const colBuilder = this.tableBuilder.integer(column).unsigned();
        return new ForeignIdBuilder(this.tableBuilder, column, colBuilder);
    }

    /**
     * Index column
     */
    public index(columns: string | string[], indexName?: string): void {
        this.tableBuilder.index(columns as any, indexName);
    }

    /**
     * Unique index column
     */
    public unique(columns: string | string[], indexName?: string): void {
        this.tableBuilder.unique(columns as any, indexName);
    }

    /**
     * Drop column
     */
    public dropColumn(column: string): void {
        this.tableBuilder.dropColumn(column);
    }

    /**
     * Rename column: table.renameColumn('old_name', 'new_name')
     */
    public renameColumn(from: string, to: string): void {
        this.tableBuilder.renameColumn(from, to);
    }

    /**
     * Drop multiple columns
     */
    public dropColumns(...columns: string[]): void {
        this.tableBuilder.dropColumns(...columns);
    }
}

/**
 * ForeignIdBuilder helper for fluent foreignId().constrained().onDelete('cascade')
 */
export class ForeignIdBuilder {
    private tableBuilder: any;
    private column: string;

    constructor(tableBuilder: any, column: string, colBuilder: Knex.ColumnBuilder) {
        this.tableBuilder = tableBuilder;
        this.column = column;
    }

    public constrained(table?: string, foreignColumn = "id"): ForeignConstraintBuilder {
        const targetTable = table || `${this.column.replace(/_id$/, "")}s`;
        const fkBuilder = this.tableBuilder.foreign(this.column).references(foreignColumn).inTable(targetTable);
        return new ForeignConstraintBuilder(fkBuilder);
    }
}

export class ForeignConstraintBuilder {
    private fkBuilder: any;

    constructor(fkBuilder: any) {
        this.fkBuilder = fkBuilder;
    }

    public onDelete(action: "cascade" | "SET NULL" | "RESTRICT" | "NO ACTION" | string): this {
        this.fkBuilder.onDelete(action.toUpperCase());
        return this;
    }

    public onUpdate(action: "cascade" | "SET NULL" | "RESTRICT" | "NO ACTION" | string): this {
        this.fkBuilder.onUpdate(action.toUpperCase());
        return this;
    }
}

/**
 * Explicit Foreign Key Builder supporting both references()/reference() and on()/inTable()
 */
export class ExplicitForeignBuilder {
    private tableBuilder: any;
    private columns: string | string[];
    private refColumns?: string | string[];
    private targetTable?: string;
    private fkBuilder?: any;

    constructor(tableBuilder: any, columns: string | string[]) {
        this.tableBuilder = tableBuilder;
        this.columns = columns;
    }

    public references(column: string | string[]): this {
        this.refColumns = column;
        return this;
    }

    public reference(column: string | string[]): this {
        return this.references(column);
    }

    public on(table: string): this {
        this.targetTable = table;
        this.buildConstraint();
        return this;
    }

    public inTable(table: string): this {
        return this.on(table);
    }

    private buildConstraint(): void {
        if (this.targetTable && this.refColumns && !this.fkBuilder) {
            this.fkBuilder = this.tableBuilder
                .foreign(this.columns)
                .references(this.refColumns)
                .inTable(this.targetTable);
        }
    }

    public onDelete(action: "cascade" | "SET NULL" | "RESTRICT" | "NO ACTION" | string): this {
        if (!this.fkBuilder) this.buildConstraint();
        if (this.fkBuilder) {
            this.fkBuilder.onDelete(action.toUpperCase());
        }
        return this;
    }

    public onUpdate(action: "cascade" | "SET NULL" | "RESTRICT" | "NO ACTION" | string): this {
        if (!this.fkBuilder) this.buildConstraint();
        if (this.fkBuilder) {
            this.fkBuilder.onUpdate(action.toUpperCase());
        }
        return this;
    }
}
