import { FastifyRequest } from "fastify";
import { UploadedFile } from "./UploadedFile.js";

export type CustomRuleCallback = (value: any, payload: Record<string, any>) => boolean | Promise<boolean>;

import { SessionStore } from "../session/SessionStore.js";

export interface Request<
    Params = Record<string, any>,
    Query = Record<string, any>,
    Body = Record<string, any>
> extends Omit<FastifyRequest, "file" | "files"> {
    /**
     * Raw body object parsed by Fastify
     */
    body: Body;

    /**
     * URL parameters object
     */
    params: Params;

    /**
     * Query string parameters object
     */
    query: Query;

    /**
     * Get active Session store instance for this request
     */
    session(): SessionStore;

    /**
     * Get incoming cookie value by name (automatically decrypted using APP_KEY)
     */
    cookie<T = string>(name: string, defaultValue?: T): T;

    /**
     * Get incoming HTTP request header value by name
     */
    header(name: string, defaultValue?: string): string | undefined;

    /**
     * Get request URL pathname without query parameters (e.g. '/users')
     */
    path(): string;

    /**
     * Get full request URL including protocol, host, and query string
     */
    fullUrl(): string;

    /**
     * Check if HTTP request method matches given string (e.g. req.isMethod('POST'))
     */
    isMethod(method: string): boolean;

    /**
     * Check if client expects a JSON response (Accept: application/json or API route)
     */
    wantsJson(): boolean;

    /**
     * Check if request payload is JSON (Content-Type: application/json)
     */
    isJson(): boolean;

    /**
     * Check if request was sent via AJAX / XMLHttpRequest
     */
    ajax(): boolean;

    /**
     * Extract Bearer token from Authorization header if present
     */
    bearerToken(): string | null;

    /**
     * Get authenticated user attached to current request context
     */
    user<T = any>(): T | null;

    /**
     * Attach authenticated user instance to current request context
     */
    setUser(user: any): void;

    /**
     * Get merged payload of params, query, and body
     */
    all(): Record<string, any>;

    /**
     * Get specific input value with optional default fallback
     */
    input<T = any>(key: string, defaultValue?: T): T;

    /**
     * Get flashed old input value for current request (e.g. req.old('email'))
     */
    old<T = any>(key?: string, defaultValue?: T): T;

    /**
     * Get only specified keys from request payload
     */
    only(...keys: string[]): Record<string, any>;

    /**
     * Get all input except specified keys
     */
    except(...keys: string[]): Record<string, any>;

    /**
     * Check if specified key exists in input
     */
    has(key: string): boolean;

    /**
     * Get single uploaded file by field name
     */
    file(key: string): Promise<UploadedFile | null>;

    /**
     * Get all uploaded files or array of files for field name
     */
    files(key?: string): Promise<UploadedFile[]>;

    /**
     * Check if request contains a valid file upload for field name
     */
    hasFile(key: string): Promise<boolean>;

    /**
     * Validate request data against validation rules
     */
    validate(
        rules: Record<string, string | CustomRuleCallback[]>,
        messages?: Record<string, string>,
        attributes?: Record<string, string>
    ): Promise<Record<string, any>>;
}
