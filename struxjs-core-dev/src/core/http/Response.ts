import { FastifyReply } from "fastify";
import type { Readable } from "stream";
import type { RedirectResponse } from "./RedirectResponse.js";

export interface Response extends FastifyReply {
    /**
     * Render HTML view template with variables
     */
    view(template: string, data?: Record<string, any>): Promise<any>;

    /**
     * Send JSON response payload
     */
    json(data: any): this;

    /**
     * Stream a Readable Node.js stream to client without loading into RAM
     */
    stream(readable: Readable, filename?: string, contentType?: string): this;

    /**
     * Stream Server-Sent Events (SSE) 1-way real-time data stream
     */
    sse(callback: (send: (data: any, event?: string, id?: string) => void, close: () => void) => void | Promise<void>): this;

    /**
     * Trigger file download attachment to browser client
     */
    download(filePath: string, filename?: any, options?: any): any;

    /**
     * Display a file inline in browser (e.g. image, PDF view)
     */
    file(filePath: string, contentType?: string): this;

    /**
     * Set AES-256-GCM encrypted HTTP Cookie on response
     */
    cookie(name: string, value: string, options?: Record<string, any>): this;

    /**
     * Clear HTTP Cookie by setting expiration date in the past
     */
    clearCookie(name: string, options?: Record<string, any>): this;

    /**
     * Set HTTP status code (e.g. response.status(201) or response.status(404))
     */
    status(statusCode: number): this;

    /**
     * Alias for response.status(statusCode)
     */
    code(statusCode: number): this;

    /**
     * Set a single HTTP response header
     * @param key Header name (e.g. 'Content-Type', 'X-Custom-Header')
     * @param value Header value
     */
    header(key: string, value: any): this;

    /**
     * Set multiple HTTP response headers at once
     * @param headers Object key-value map of headers
     */
    headers(headers: Record<string, any>): this;

    /**
     * Set Content-Type response header shortcut (e.g. response.type('application/json'))
     */
    type(contentType: string): this;

    /**
     * Send final raw payload response to client
     */
    send(payload?: any): this;

    /**
     * Redirect request to a target URL or return fluent RedirectResponse builder
     * @example
     * response.redirect('/login')
     * response.redirect().route('users.index')
     * response.redirect().route('users.show', { id: 1 }).with('success', 'Updated!')
     */
    redirect(): RedirectResponse;
    redirect(url: string, code?: number): RedirectResponse;
    redirect(code: number, url: string): RedirectResponse;
}
