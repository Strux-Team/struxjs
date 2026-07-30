// src/core/validation/ValidationError.ts (Core level)
export class ValidationError extends Error {
    // Identifier flag for validation error class
    public readonly isStruxValidationError = true;

    constructor(public errors: Record<string, string[]>) {
        super("The given data was invalid.");
        this.name = "ValidationError";

        // Maintain proper prototype chain for standard Node.js Error
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
