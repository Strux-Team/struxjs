/**
 * HttpException — specialized exception for HTTP error responses.
 *
 * Usage:
 *   throw new HttpException(404, "Resource not found");
 *   throw new HttpException(403, "Unauthorized access", { "X-Custom": "Header" });
 */
export class HttpException extends Error {
    public readonly statusCode: number;
    public readonly headers: Record<string, string>;

    constructor(
        statusCode: number,
        message?: string,
        headers: Record<string, string> = {}
    ) {
        super(message || HttpException.getDefaultMessage(statusCode));
        this.name = "HttpException";
        this.statusCode = statusCode;
        this.headers = headers;

        // Maintain proper stack trace (V8 engines)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, HttpException);
        }
    }

    /**
     * Default messages for common HTTP status codes.
     */
    private static getDefaultMessage(statusCode: number): string {
        const messages: Record<number, string> = {
            400: "Bad Request",
            401: "Unauthorized",
            402: "Payment Required",
            403: "Forbidden",
            404: "Not Found",
            405: "Method Not Allowed",
            406: "Not Acceptable",
            408: "Request Timeout",
            409: "Conflict",
            410: "Gone",
            413: "Payload Too Large",
            415: "Unsupported Media Type",
            422: "Unprocessable Entity",
            429: "Too Many Requests",
            500: "Internal Server Error",
            501: "Not Implemented",
            502: "Bad Gateway",
            503: "Service Unavailable",
            504: "Gateway Timeout",
        };
        return messages[statusCode] || "HTTP Error";
    }

    /**
     * Check if an error is an HttpException.
     */
    public static isHttpException(error: any): error is HttpException {
        return error instanceof HttpException || error?.name === "HttpException";
    }
}
