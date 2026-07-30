export class AuthorizationError extends Error {
    public statusCode = 403;

    constructor(message = "This action is unauthorized.", public ability?: string) {
        super(message);
        this.name = "AuthorizationError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
