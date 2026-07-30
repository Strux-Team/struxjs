import { FastifyRequest } from "fastify";
import { validatePayload } from "../http/HttpContext.js";

export abstract class FormRequest {
    // Holds the reference to the underlying native Fastify request
    public request!: FastifyRequest;

    // Holds the validated and filtered data payload
    public validatedData: Record<string, any> = {};

    /**
     * Get HTTP request method (e.g. GET, POST, PUT, DELETE)
     */
    public get method(): string {
        return this.request ? this.request.method : "";
    }

    /**
     * Get HTTP request URL
     */
    public get url(): string {
        return this.request ? this.request.url : "";
    }

    /**
     * Get HTTP request headers
     */
    public get headers(): any {
        return this.request ? this.request.headers : {};
    }

    /**
     * Get HTTP request query parameters
     */
    public get query(): any {
        return this.request ? (this.request.query as Record<string, any>) : {};
    }

    /**
     * Get raw HTTP request body
     */
    public get body(): any {
        return this.request ? (this.request.body as Record<string, any>) : {};
    }

    /**
     * Get route URL parameters
     */
    public get params(): any {
        return this.request ? (this.request.params as Record<string, any>) : {};
    }

    /**
     * Get client IP address
     */
    public get ip(): string {
        return this.request ? this.request.ip : "";
    }

    /**
     * Internal bootloader used by the framework to initialize request context
     */
    public async boot(req: FastifyRequest): Promise<void> {
        this.request = req;

        const rules = this.rules();
        const messages = this.messages();
        const attributes = this.attributes();
        const rawBody = (req.body as Record<string, any>) || {};

        // Trigger the global validation engine asynchronously
        this.validatedData = await validatePayload(rawBody, rules, messages, attributes);
    }

    /**
     * Define the validation rules for the request
     */
    public abstract rules(): Record<string, any>;

    /**
     * Define the custom error messages for the rules (Optional)
     */
    public messages(): Record<string, string> {
        return {};
    }

    /**
     * Define the user-friendly attribute names for fields (Optional)
     */
    public attributes(): Record<string, string> {
        return {};
    }

    /**
     * Dynamically fetch inputs directly from the validated request object
     */
    public input(key: string, defaultValue: any = null): any {
        return this.validatedData[key] !== undefined ? this.validatedData[key] : defaultValue;
    }

    /**
     * Get all validated data inputs
     */
    public all(): Record<string, any> {
        return this.validatedData;
    }

    /**
     * Alias for all() - Get all validated data inputs
     */
    public validated(): Record<string, any> {
        return this.validatedData;
    }

    /**
     * Get a specific route URL parameter (e.g. this.param('id') for /users/:id)
     */
    public param(key: string, defaultValue: any = null): any {
        const routeParams = this.params;
        return routeParams && routeParams[key] !== undefined ? routeParams[key] : defaultValue;
    }

    /**
     * Alias for param() - Get a specific route URL parameter
     */
    public routeParam(key: string, defaultValue: any = null): any {
        return this.param(key, defaultValue);
    }
}
