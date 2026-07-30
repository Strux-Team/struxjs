export class ErrorBag {
    constructor(private errorsMap: Record<string, string[]> = {}) {}

    /**
     * Check if a specific field has validation errors
     */
    public has(field: string): boolean {
        return Boolean(this.errorsMap[field] && this.errorsMap[field].length > 0);
    }

    /**
     * Get the first error message for a specific field
     */
    public first(field: string): string {
        return this.has(field) ? this.errorsMap[field][0] : "";
    }

    /**
     * Get all error messages for a specific field
     */
    public get(field: string): string[] {
        return this.errorsMap[field] || [];
    }

    /**
     * Check if there are any validation errors across all fields
     */
    public any(): boolean {
        return Object.keys(this.errorsMap).length > 0;
    }

    /**
     * Get raw errors map
     */
    public all(): Record<string, string[]> {
        return this.errorsMap;
    }
}
