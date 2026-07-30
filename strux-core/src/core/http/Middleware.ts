export interface Middleware {
    /**
     * Handle the incoming request.
     * If access is denied, use response.redirect() or reply.send().
     * If access is granted, simply return to let the lifecycle continue.
     *
     * @param request  - Request object
     * @param response - Response object
     * @param params   - Optional parameters parsed from the middleware token (e.g. 'role:admin' → params = ['admin'])
     */
    handle(request: any, response: any, ...params: string[]): Promise<void> | void;
}
