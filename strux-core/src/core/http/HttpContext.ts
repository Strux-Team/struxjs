import { AsyncLocalStorage } from "async_hooks";
import { FastifyRequest, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import util from "util";
import { config, env } from "../config/Config.js";
import { ValidationError } from "../validation/ValidationError.js";
import { HttpException } from "./HttpException.js";
import { RedirectResponse } from "./RedirectResponse.js";
import { trans, __ } from "../lang/LangManager.js";

export interface HttpContextStore {
    request: FastifyRequest;
    reply: FastifyReply;
    // Per-request user cache — keyed by "<guard>:<userId>" to support multi-guard
    userCache: Map<string, any>;
}

export const httpContextStorage = new AsyncLocalStorage<HttpContextStore>();

/**
 * Create a fresh context store for a new request.
 * @internal
 */
export function createContextStore(request: FastifyRequest, reply: FastifyReply): HttpContextStore {
    return { request, reply, userCache: new Map() };
}

export type CustomRuleCallback = (value: any, payload: Record<string, any>) => boolean | Promise<boolean>;

declare module "fastify" {
    interface FastifyRequest {
        validate(
            rules: Record<string, string | CustomRuleCallback[]>,
            messages?: Record<string, string>,
            attributes?: Record<string, string>
        ): Promise<Record<string, any>>;
    }
}

import { Request } from "./Request.js";
import { Response } from "./Response.js";
import { UploadedFile } from "./UploadedFile.js";
import { SessionStore } from "../session/SessionStore.js";

function getEncryptionKey(secret: string): Buffer {
    return crypto.createHash("sha256").update(secret).digest();
}

function encryptCookieValue(value: string, secret: string): string {
    const key = getEncryptionKey(secret);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `e:${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

function decryptCookieValue(encrypted: string, secret: string): string | null {
    if (!encrypted || !encrypted.startsWith("e:")) return null;

    const parts = encrypted.slice(2).split(".");
    if (parts.length !== 3) return null;

    const [ivHex, tagHex, cipherHex] = parts;
    try {
        const key = getEncryptionKey(secret);
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const ciphertext = Buffer.from(cipherHex, "hex");

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString("utf8");
    } catch {
        return null;
    }
}

export function wantsJsonRequest(req: FastifyRequest): boolean {
    const accept = (req.headers?.accept || "").toLowerCase();
    const isXml = req.headers?.["x-requested-with"] === "XMLHttpRequest";
    const url = req.url || "/";
    const isApi = url.startsWith("/api/") || url === "/api";

    if (isApi || isXml) return true;

    if (accept.includes("text/html")) {
        const htmlIdx = accept.indexOf("text/html");
        const jsonIdx = accept.indexOf("application/json");
        if (jsonIdx === -1 || htmlIdx < jsonIdx) {
            return false;
        }
    }

    return accept.includes("application/json");
}

export function decorateRequest(req: FastifyRequest): Request {
    const fastifyReq = req as any;
    if (!fastifyReq.all) {
        // Build map of UploadedFile objects — lazy async parse, resolved on first file() call
        let parsedFilesMap: Record<string, UploadedFile[]> | null = null;
        let parsePromise: Promise<void> | null = null;

        const ensureParsed = (): Promise<void> => {
            if (parsedFilesMap !== null) return Promise.resolve();
            if (parsePromise) return parsePromise;

            parsePromise = (async () => {
                parsedFilesMap = {};
                const body = (fastifyReq.body as Record<string, any>) || {};

                const parseFileObject = async (fieldname: string, item: any) => {
                    if (!item || typeof item !== "object") return;

                    if (item instanceof UploadedFile) {
                        if (!parsedFilesMap![fieldname]) parsedFilesMap![fieldname] = [];
                        parsedFilesMap![fieldname].push(item);
                    } else if (item.type === "file" && typeof item.toBuffer === "function") {
                        // @fastify/multipart with attachFieldsToBody: true
                        const buffer = await item.toBuffer();
                        const uploadedFile = new UploadedFile({
                            filename: item.filename || `upload_${Date.now()}`,
                            originalName: item.filename || `upload_${Date.now()}`,
                            mimeType: item.mimetype || "application/octet-stream",
                            buffer
                        });
                        if (!parsedFilesMap![fieldname]) parsedFilesMap![fieldname] = [];
                        parsedFilesMap![fieldname].push(uploadedFile);
                    } else if (item.filename && item.buffer instanceof Buffer) {
                        // Already-buffered format
                        const uploadedFile = new UploadedFile({
                            filename: item.filename,
                            originalName: item.filename || item.originalname,
                            mimeType: item.mimetype || item.mimeType || "application/octet-stream",
                            buffer: item.buffer
                        });
                        if (!parsedFilesMap![fieldname]) parsedFilesMap![fieldname] = [];
                        parsedFilesMap![fieldname].push(uploadedFile);
                    }
                };

                for (const [key, value] of Object.entries(body)) {
                    if (Array.isArray(value)) {
                        for (const item of value) await parseFileObject(key, item);
                    } else {
                        await parseFileObject(key, value);
                    }
                }
            })();

            return parsePromise;
        };

        fastifyReq.file = async function (key: string): Promise<UploadedFile | null> {
            await ensureParsed();
            const list = parsedFilesMap?.[key];
            return list && list.length > 0 ? list[0] : null;
        };

        fastifyReq.files = async function (key?: string): Promise<UploadedFile[]> {
            await ensureParsed();
            if (key) {
                return parsedFilesMap?.[key] || [];
            }
            const allFiles: UploadedFile[] = [];
            for (const list of Object.values(parsedFilesMap || {})) {
                allFiles.push(...(list as UploadedFile[]));
            }
            return allFiles;
        };

        fastifyReq.hasFile = async function (key: string): Promise<boolean> {
            const file = await this.file(key);
            return file !== null && file.isValid();
        };

        fastifyReq.session = function (): SessionStore {
            if (!this.sessionInstance) {
                this.sessionInstance = new SessionStore();
            }
            return this.sessionInstance;
        };



        fastifyReq.cookie = function (name: string, defaultValue?: any) {
            const cookies = this.cookies || {};
            let rawValue = cookies[name];

            if (rawValue === undefined && this.headers?.cookie) {
                const match = this.headers.cookie.match(new RegExp(`(?:^|; )\\s*${name}\\s*=\\s*([^;]+)`));
                if (match) {
                    rawValue = match[1];
                }
            }

            if (rawValue === undefined) return defaultValue;

            if (typeof rawValue === "string") {
                try {
                    rawValue = decodeURIComponent(rawValue);
                } catch {
                    // keep rawValue
                }
            }

            const secret = config("app.key") || env("APP_KEY", "struxjs_secret_app_key_32bytes_long");

            if (typeof rawValue === "string" && rawValue.startsWith("e:")) {
                const decrypted = decryptCookieValue(rawValue, secret);
                if (decrypted !== null) {
                    return decrypted;
                }
            } else if (typeof rawValue === "string" && rawValue.startsWith("s:")) {
                if (typeof this.unsignCookie === "function") {
                    const unsigned = this.unsignCookie(rawValue);
                    if (unsigned.valid && unsigned.value !== null) {
                        return unsigned.value;
                    }
                }

                const lastDot = rawValue.lastIndexOf(".");
                if (lastDot > 2) {
                    const val = rawValue.slice(2, lastDot);
                    const expectedSig = crypto.createHmac("sha256", secret).update(val).digest("base64").replace(/=+$/, "");
                    const actualSig = rawValue.slice(lastDot + 1);
                    if (expectedSig === actualSig) {
                        return val;
                    }
                }
            }

            return rawValue !== undefined ? rawValue : defaultValue;
        };

function unwrapMultipartValue(v: any): any {
    if (v === null || v === undefined) return v;

    if (v instanceof UploadedFile) return undefined;

    if (typeof v === "object") {
        if (v.type === "field" && v.value !== undefined) {
            return v.value;
        }
        if (v.type === "file" || typeof v.toBuffer === "function" || v.filename !== undefined) {
            return undefined;
        }
    }

    if (Array.isArray(v)) {
        const unwrapped = v.map(item => unwrapMultipartValue(item)).filter(item => item !== undefined);
        return unwrapped;
    }

    return v;
}

        fastifyReq.all = function () {
            const b = typeof this.body === "object" && this.body !== null ? this.body : {};
            const cleanBody: Record<string, any> = {};
            for (const [k, v] of Object.entries(b)) {
                const unwrapped = unwrapMultipartValue(v);
                if (unwrapped !== undefined) {
                    cleanBody[k] = unwrapped;
                }
            }
            const query = typeof this.query === "object" && this.query !== null ? this.query : {};
            const params = typeof this.params === "object" && this.params !== null ? this.params : {};
            return { ...params, ...query, ...cleanBody };
        };

        fastifyReq.input = function (key: string, defaultValue?: any) {
            const allData = this.all();
            return allData[key] !== undefined ? allData[key] : defaultValue;
        };

        fastifyReq.old = function (key?: string, defaultValue?: any) {
            const sessionStore = this.session();
            const flashOld = sessionStore ? sessionStore.get("old") || {} : {};
            if (!key) return flashOld;
            return flashOld[key] !== undefined ? flashOld[key] : defaultValue;
        };

        fastifyReq.only = function (...keys: string[]) {
            const allData = this.all();
            const result: Record<string, any> = {};
            keys.forEach(k => {
                if (k in allData) result[k] = allData[k];
            });
            return result;
        };

        fastifyReq.except = function (...keys: string[]) {
            const allData = this.all();
            const result: Record<string, any> = { ...allData };
            keys.forEach(k => delete result[k]);
            return result;
        };

        fastifyReq.has = function (key: string) {
            const allData = this.all();
            return key in allData && allData[key] !== null && allData[key] !== undefined;
        };

        fastifyReq.header = function (name: string, defaultValue?: string) {
            const lcName = name.toLowerCase();
            const val = this.headers[lcName];
            if (val === undefined) return defaultValue;
            return Array.isArray(val) ? val.join(", ") : String(val);
        };

        fastifyReq.path = function () {
            const rawUrl = this.url || "/";
            const qIdx = rawUrl.indexOf("?");
            return qIdx !== -1 ? rawUrl.slice(0, qIdx) : rawUrl;
        };

        fastifyReq.fullUrl = function () {
            const proto = this.protocol || "http";
            const host = this.hostname || this.headers?.host || "localhost";
            return `${proto}://${host}${this.url || "/"}`;
        };

        fastifyReq.isMethod = function (m: string) {
            return (this.method || "").toUpperCase() === m.toUpperCase();
        };

        fastifyReq.wantsJson = function () {
            return wantsJsonRequest(this);
        };

        fastifyReq.isJson = function () {
            const ct = (this.headers?.["content-type"] || "").toLowerCase();
            return ct.includes("application/json");
        };

        fastifyReq.ajax = function () {
            return this.headers?.["x-requested-with"] === "XMLHttpRequest";
        };

        fastifyReq.bearerToken = function () {
            const authHeader = this.headers?.authorization || this.headers?.Authorization;
            if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
                return authHeader.slice(7).trim();
            }
            return null;
        };

        fastifyReq.user = function <T = any>(): T | null {
            return this._authUser || null;
        };

        fastifyReq.setUser = function (u: any) {
            this._authUser = u;
        };
    }
    return fastifyReq;
}

export function request(): Request {
    const store = httpContextStorage.getStore();
    if (!store) throw new Error("[StruxJS HTTP Error]: request() helper context error.");
    return decorateRequest(store.request);
}

export function decorateResponse(rep: FastifyReply): Response {
    const reply = rep as any;

    if (!reply.rawSend) {
        reply.rawSend = reply.send;
        reply.send = function (payload?: any) {
            if (typeof payload === "string" && !this.getHeader("content-type")) {
                const store = httpContextStorage.getStore();
                const req = store?.request;
                if (req && !wantsJsonRequest(req)) {
                    this.type("text/html; charset=utf-8");
                }
            }
            return this.rawSend(payload);
        };
    }

    if (!reply.json) {
        reply.json = function (data: any) {
            return this.type("application/json").send(data);
        };
    }

    if (!reply.view) {
        reply.view = function (template: string, data?: Record<string, any>) {
            return view(template, data) as any;
        };
    }

    if (!reply.stream) {
        reply.stream = function (readable: any, filename?: string, contentType?: string) {
            if (contentType) this.type(contentType);
            if (filename) this.header("Content-Disposition", `attachment; filename="${filename}"`);
            return this.send(readable);
        };
    }

    if (!reply.sse) {
        reply.sse = function (callback: (send: (data: any, event?: string, id?: string) => void, close: () => void) => void | Promise<void>) {
            this.raw.setHeader("Content-Type", "text/event-stream");
            this.raw.setHeader("Cache-Control", "no-cache");
            this.raw.setHeader("Connection", "keep-alive");
            this.raw.setHeader("Access-Control-Allow-Origin", "*");
            if (typeof this.raw.flushHeaders === "function") {
                this.raw.flushHeaders();
            }

            const send = (data: any, event?: string, id?: string) => {
                if (id) this.raw.write(`id: ${id}\n`);
                if (event) this.raw.write(`event: ${event}\n`);
                const payload = typeof data === "object" ? JSON.stringify(data) : String(data);
                this.raw.write(`data: ${payload}\n\n`);
            };

            const close = () => {
                this.raw.end();
            };

            callback(send, close);
            return this;
        };
    }

    if (!reply.download) {
        reply.download = function (filePath: string, filename?: string, headers?: Record<string, string>) {
            const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`[StruxJS Response Error]: Download file not found at '${absolutePath}'`);
            }

            const downloadName = filename || path.basename(absolutePath);
            const ext = path.extname(absolutePath).toLowerCase();
            const mimeType = getMimeType(ext);

            this.header("Content-Disposition", `attachment; filename="${downloadName}"`);
            this.type(mimeType);

            if (headers) {
                for (const [k, v] of Object.entries(headers)) {
                    this.header(k, v);
                }
            }

            return this.send(fs.createReadStream(absolutePath));
        };
    }

    if (!reply.file) {
        reply.file = function (filePath: string, contentType?: string) {
            const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`[StruxJS Response Error]: File not found at '${absolutePath}'`);
            }

            const ext = path.extname(absolutePath).toLowerCase();
            const mimeType = contentType || getMimeType(ext);

            this.type(mimeType);
            return this.send(fs.createReadStream(absolutePath));
        };
    }

    reply.cookie = function (name: string, value: string, options?: any) {
        if (typeof this.setCookie === "function") {
            const shouldEncrypt = options?.encrypt !== false && options?.signed !== false;
            let finalVal = String(value);
            if (shouldEncrypt) {
                const secret = config("app.key") || env("APP_KEY", "struxjs_secret_app_key_32bytes_long");
                finalVal = encryptCookieValue(finalVal, secret);
            }

            return this.setCookie(name, finalVal, {
                path: "/",
                httpOnly: true,
                sameSite: "lax",
                ...options
            });
        }
        return this;
    };

    reply.clearCookie = function (name: string, options?: any) {
        if (typeof this.setCookie === "function") {
            return this.setCookie(name, "", {
                path: "/",
                expires: new Date(0),
                ...options
            });
        }
        return this;
    };

    if (!reply.rawRedirect) {
        reply.rawRedirect = reply.redirect;
    }

    reply.redirect = function (urlOrCode?: string | number, codeOrUrl?: string | number) {
        let targetUrl: string | undefined;
        let statusCode = 302;

        if (typeof urlOrCode === "string") {
            targetUrl = urlOrCode;
            if (typeof codeOrUrl === "number") statusCode = codeOrUrl;
        } else if (typeof urlOrCode === "number") {
            statusCode = urlOrCode;
            if (typeof codeOrUrl === "string") targetUrl = codeOrUrl;
        }

        return new RedirectResponse(this, targetUrl, statusCode);
    };

    return reply as Response;
}

export function response(rep?: FastifyReply): Response {
    if (rep) return decorateResponse(rep);
    const store = httpContextStorage.getStore();
    if (!store) throw new Error("[StruxJS HTTP Error]: response() helper context error.");
    return decorateResponse(store.reply);
}

function getMimeType(ext: string): string {
    const map: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".csv": "text/csv",
        ".txt": "text/plain",
        ".html": "text/html",
        ".json": "application/json",
        ".zip": "application/zip",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".mp3": "audio/mpeg",
        ".mp4": "video/mp4"
    };
    return map[ext] || "application/octet-stream";
}

import { ErrorBag } from "../validation/ErrorBag.js";

/**
 * Global View helper to render HTML views using current HTTP context
 * Usage: return view("users/index", { users });
 */
export async function view(template: string, data: Record<string, any> = {}): Promise<any> {
    const store = httpContextStorage.getStore();
    if (!store) throw new Error("[StruxJS HTTP Error]: view() helper context error. Must be called within HTTP request context.");
    const reply = store.reply as any;

    let viewData = { ...data };

    try {
        const reqDecorated = decorateRequest(store.request);
        const sessionStore = reqDecorated.session();
        const flashErrors = sessionStore.get("errors") || {};
        const flashOld = sessionStore.get("old") || {};

        const errorBag = new ErrorBag(flashErrors);
        const oldHelper = (key: string, defaultValue: any = "") => {
            return flashOld[key] !== undefined ? flashOld[key] : defaultValue;
        };

        const sessionHelper = (key?: string, defaultValue?: any) => {
            if (!key) return sessionStore;
            return sessionStore.get(key, defaultValue);
        };

        let currentAuthUser: any = reqDecorated.user();
        if (!currentAuthUser) {
            try {
                const { Auth } = await import("../auth/Auth.js");
                currentAuthUser = await Auth.user();
                if (currentAuthUser) {
                    reqDecorated.setUser(currentAuthUser);
                }
            } catch {}
        }

        const csrfTokenVal = sessionStore.get("_token") || reqDecorated.cookie("XSRF-TOKEN") || "";
        const csrfTokenHelper: any = () => sessionStore.get("_token") || reqDecorated.cookie("XSRF-TOKEN") || "";
        csrfTokenHelper.toString = () => sessionStore.get("_token") || reqDecorated.cookie("XSRF-TOKEN") || "";
        csrfTokenHelper.valueOf = () => sessionStore.get("_token") || reqDecorated.cookie("XSRF-TOKEN") || "";

        viewData = {
            user: currentAuthUser,
            _token: csrfTokenVal,
            csrf_token: csrfTokenHelper,
            errors: errorBag,
            $errors: errorBag,
            old: oldHelper,
            session: sessionHelper,
            trans,
            __: __,
            ...data
        };
    } catch {}

    if (typeof reply.view === "function") {
        reply.type("text/html; charset=utf-8");
        return reply.view(template, viewData);
    }
    return { template, data: viewData };
}

/**
 * Global csrf_token() helper function returning active CSRF token for current HTTP request context
 */
export function csrf_token(): string {
    const store = httpContextStorage.getStore();
    if (!store) return "";
    const reqDecorated = decorateRequest(store.request);
    const sessionStore = reqDecorated.session();
    return sessionStore.get("_token") || reqDecorated.cookie("XSRF-TOKEN") || "";
}

/**
 * Global session() helper:
 * - session() -> SessionStore
 * - session('key') -> sessionStore.get('key')
 * - session('key', defaultValue) -> sessionStore.get('key', defaultValue)
 * - session({ key: value }) -> sessionStore.put(key, value)
 */
export function session<T = any>(key?: string | Record<string, any>, defaultValue?: any): any {
    const store = httpContextStorage.getStore();
    if (!store) throw new Error("[StruxJS HTTP Error]: session() helper context error. Must be called within HTTP request context.");
    const sessionStore = decorateRequest(store.request).session();

    if (!key) return sessionStore;

    if (typeof key === "object" && key !== null) {
        for (const [k, v] of Object.entries(key)) {
            sessionStore.put(k, v);
        }
        return sessionStore;
    }

    return sessionStore.get(key, defaultValue);
}

/**
 * Global old() helper function returning flashed old input value for current request context
 * @param key Optional input field name (e.g. 'email')
 * @param defaultValue Optional fallback value
 */
export function old<T = any>(key?: string, defaultValue?: any): T {
    const store = httpContextStorage.getStore();
    if (!store) return defaultValue as T;
    return decorateRequest(store.request).old<T>(key, defaultValue);
}

/**
 * Global redirect() helper function returning RedirectResponse for current HTTP request context
 * @param url Optional target URL or route path (e.g. '/login')
 * @param code Optional HTTP Status Code (e.g. 301, 302)
 */
export function redirect(url?: string, code?: number): RedirectResponse {
    const store = httpContextStorage.getStore();
    if (!store) throw new Error("[StruxJS HTTP Error]: redirect() helper context error. Must be called within HTTP request context.");
    const decoratedRep = decorateResponse(store.reply);
    return decoratedRep.redirect(url as any, code as any);
}

/**
 * PRODUCTION-READY VALIDATION ENGINE WITH ALL POPULAR RULES AND ASYNC DB UNIQUE RULE
 */
export async function validatePayload(
    payload: Record<string, any>,
    rules: Record<string, string | CustomRuleCallback[]>,
    customMessages: Record<string, string> = {},
    customAttributes: Record<string, string> = {}
): Promise<Record<string, any>> {
    const errors: Record<string, string[]> = {};
    const validatedData: Record<string, any> = {};

    for (const field of Object.keys(rules)) {
        const value = payload[field];
        const rawRules = rules[field];
        validatedData[field] = value;

        const attributeName = customAttributes[field] || field;

        const getErrorMessage = (ruleName: string, defaultMsg: string, ruleValue?: string): string => {
            const specificKey = `${field}.${ruleName}`;
            let message = customMessages[specificKey] || customMessages[ruleName] || defaultMsg;

            message = message.replace(/:attribute/g, attributeName);
            if (ruleValue) {
                message = message.replace(/:value/g, ruleValue);
            }
            return message;
        };

        // --- CASE 1: PROCESSING STANDARD STRING RULES ---
        if (typeof rawRules === "string") {
            const fieldRules = rawRules.split("|");

            const currentStore = httpContextStorage.getStore();
            const currentReqInstance = currentStore ? decorateRequest(currentStore.request) : null;
            const currentUploadedFile = (await currentReqInstance?.file(field)) || (value instanceof UploadedFile ? value : null);

            for (const ruleStr of fieldRules) {
                const [ruleName, ruleValue] = ruleStr.split(":");

                // 1. Rule: required (supports uploaded file check)
                if (ruleName === "required") {
                    const isFileRule = fieldRules.includes("file") || fieldRules.includes("image") || fieldRules.some(r => r.startsWith("mimes:"));
                    const isEmpty = isFileRule
                        ? (!currentUploadedFile || !currentUploadedFile.isValid())
                        : (value === undefined || value === null || value === "");

                    if (isEmpty) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute field is required.`));
                        break;
                    }
                }

                // 11. FILE RULE: file
                if (ruleName === "file") {
                    if (!currentUploadedFile || !currentUploadedFile.isValid()) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute must be a file.`));
                    }
                }

                // 12. FILE RULE: image
                if (ruleName === "image") {
                    if (currentUploadedFile && currentUploadedFile.isValid()) {
                        const imgExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
                        const realExt = currentUploadedFile.realExtension();
                        const realMime = currentUploadedFile.realMimeType();
                        const isImg = imgExts.includes(realExt) || realMime.startsWith("image/");
                        if (!isImg || currentUploadedFile.isFakeExtension()) {
                            if (!errors[field]) errors[field] = [];
                            errors[field].push(getErrorMessage(ruleName, `The :attribute must be a valid authentic image.`));
                        }
                    }
                }

                // 13. FILE RULE: mimes (Usage: 'mimes:png,jpg,pdf')
                if (ruleName === "mimes" && ruleValue) {
                    if (currentUploadedFile && currentUploadedFile.isValid()) {
                        const allowedExts = ruleValue.split(",").map(e => e.trim().toLowerCase());
                        const realExt = currentUploadedFile.realExtension();
                        if (!allowedExts.includes(realExt) || currentUploadedFile.isFakeExtension()) {
                            if (!errors[field]) errors[field] = [];
                            errors[field].push(getErrorMessage(ruleName, `The :attribute must be a file of type: :value.`, ruleValue));
                        }
                    }
                }

                if ((value !== undefined && value !== null && value !== "") || (currentUploadedFile && currentUploadedFile.isValid())) {

                    // 2. Rule: email
                    if (ruleName === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute must be a valid email address.`));
                    }

                    // 3. RULE: unique (Usage: 'unique:users,email' or 'unique:users')
                    if (ruleName === "unique") {
                        if (!ruleValue) {
                            throw new Error(`[StruxJS Validator Error]: The 'unique' rule requires parameters (e.g., 'unique:users').`);
                        }

                        const [tableName, columnName, exceptId, idColumn] = ruleValue.split(",");
                        const targetColumn = columnName || field;
                        const targetIdColumn = idColumn || "id";

                        try {
                            const { BaseModel } = await import("../database/BaseModel.js");
                            const db = BaseModel.connection();
                            let query = db(tableName).where(targetColumn, value);

                            if (exceptId !== undefined && exceptId !== null && exceptId !== "") {
                                query = query.whereNot(targetIdColumn, exceptId);
                            }

                            const exist = await query.first();

                            if (exist) {
                                if (!errors[field]) errors[field] = [];
                                errors[field].push(getErrorMessage(ruleName, `The :attribute has already been taken.`));
                            }
                        } catch (dbError: any) {
                            throw new Error(`[StruxJS Database Validation Error]: Failed checking unique constraint. ${dbError.message}`);
                        }
                    }

                    // 4. Rule: min
                    if (ruleName === "min") {
                        if (currentUploadedFile && currentUploadedFile.isValid()) {
                            const minKB = Number(ruleValue);
                            if (currentUploadedFile.size < minKB * 1024) {
                                if (!errors[field]) errors[field] = [];
                                errors[field].push(getErrorMessage("min", `The :attribute must be at least :value kilobytes.`, ruleValue));
                            }
                        } else {
                            const isNum = typeof value === "number" || fieldRules.includes("numeric") || fieldRules.includes("integer");
                            const condition = isNum ? Number(value) < Number(ruleValue) : String(value).length < Number(ruleValue);
                            if (condition) {
                                if (!errors[field]) errors[field] = [];
                                errors[field].push(getErrorMessage(ruleName, isNum ? `The :attribute must be at least :value.` : `The :attribute must be at least :value characters.`, ruleValue));
                            }
                        }
                    }

                    // 5. Rule: max
                    if (ruleName === "max") {
                        if (currentUploadedFile && currentUploadedFile.isValid()) {
                            const maxKB = Number(ruleValue);
                            if (currentUploadedFile.size > maxKB * 1024) {
                                if (!errors[field]) errors[field] = [];
                                errors[field].push(getErrorMessage("max", `The :attribute must not be greater than :value kilobytes.`, ruleValue));
                            }
                        } else {
                            const isNum = typeof value === "number" || fieldRules.includes("numeric") || fieldRules.includes("integer");
                            const condition = isNum ? Number(value) > Number(ruleValue) : String(value).length > Number(ruleValue);
                            if (condition) {
                                if (!errors[field]) errors[field] = [];
                                errors[field].push(getErrorMessage(ruleName, isNum ? `The :attribute must not be greater than :value.` : `The :attribute must not be greater than :value characters.`, ruleValue));
                            }
                        }
                    }

                    // 6. Rule: numeric
                    if (ruleName === "numeric" && (isNaN(Number(value)) || typeof value === 'boolean')) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute must be a valid number.`));
                    }

                    // 7. Rule: alpha
                    if (ruleName === "alpha" && !/^[a-zA-Z]+$/.test(value)) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute may only contain letters.`));
                    }

                    // 8. Rule: alpha_num
                    if (ruleName === "alpha_num" && !/^[a-zA-Z0-9]+$/.test(value)) {
                        if (!errors[field]) errors[field] = [];
                        errors[field].push(getErrorMessage(ruleName, `The :attribute may only contain letters and numbers.`));
                    }

                    // 9. Rule: confirmed
                    if (ruleName === "confirmed") {
                        const confirmationField = `${field}_confirmation`;
                        if (payload[confirmationField] !== value) {
                            if (!errors[field]) errors[field] = [];
                            errors[field].push(getErrorMessage(ruleName, `The :attribute confirmation does not match.`));
                        }
                    }

                    // 10. Rule: in
                    if (ruleName === "in") {
                        const allowedValues = ruleValue.split(",");
                        if (!allowedValues.includes(String(value))) {
                            if (!errors[field]) errors[field] = [];
                            errors[field].push(getErrorMessage(ruleName, `The selected :attribute is invalid.`));
                        }
                    }
                }
            }
        }
        // --- CASE 2: PROCESSING CUSTOM RULES ---
        else if (Array.isArray(rawRules)) {
            for (let i = 0; i < rawRules.length; i++) {
                const customRuleCallback = rawRules[i];
                const passed = await customRuleCallback(value, payload);
                if (!passed) {
                    if (!errors[field]) errors[field] = [];
                    errors[field].push(getErrorMessage(`custom_${i}`, `The :attribute field failed validation check.`));
                }
            }
        }
    }

    if (Object.keys(errors).length > 0) {
        throw new ValidationError(errors);
    }

    return validatedData;
}

/**
 * Abort the current request with an HTTP error.
 *
 * Usage:
 *   abort(404);
 *   abort(403, "You don't have permission");
 *   abort(503, "Maintenance mode", { "Retry-After": "3600" });
 *
 * For web routes: renders error view (resources/views/errors/{code}.strux)
 * For API routes: returns JSON response
 */
export function abort(
    statusCode: number,
    message?: string,
    headers?: Record<string, string>
): never {
    throw new HttpException(statusCode, message, headers);
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCallerLocation(): string {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes("HttpContext") && !line.includes("node_modules") && !line.includes("node:")) {
            const match = line.match(/\((.*):(\d+):(\d+)\)/) || line.match(/at (.*):(\d+):(\d+)/);
            if (match) {
                const filePath = match[1];
                const lineNum = match[2];
                const relPath = path.relative(process.cwd(), filePath);
                return `${relPath}:${lineNum}`;
            }
        }
    }
    return "";
}

function renderValueToHtml(val: any, depth = 0): string {
    if (val === null) return `<span style="color: #94a3b8; font-weight: bold;">null</span>`;
    if (val === undefined) return `<span style="color: #64748b; font-weight: bold;">undefined</span>`;
    if (typeof val === "boolean") return `<span style="color: #c084fc; font-weight: bold;">${val}</span>`;
    if (typeof val === "number") return `<span style="color: #38bdf8; font-weight: bold;">${val}</span>`;
    if (typeof val === "string") return `<span style="color: #4ade80;">"${escapeHtml(val)}"</span> <span style="color: #64748b; font-size: 11px;">(length=${val.length})</span>`;
    if (typeof val === "function") return `<span style="color: #f43f5e; font-style: italic;">ƒ ${val.name || "anonymous"}()</span>`;

    if (val instanceof Date) return `<span style="color: #facc15;">Date("${val.toISOString()}")</span>`;

    if (Array.isArray(val)) {
        if (val.length === 0) return `<span style="color: #cbd5e1;">[]</span>`;
        if (depth > 6) return `<span style="color: #94a3b8;">Array(${val.length}) [...]</span>`;

        const items = val.map((item, idx) => `
            <div style="padding-left: 20px; margin-top: 2px;">
                <span style="color: #94a3b8;">${idx} => </span>${renderValueToHtml(item, depth + 1)}
            </div>
        `).join("");

        return `
            <details ${depth === 0 ? "open" : ""}>
                <summary style="cursor: pointer; color: #60a5fa; font-weight: 600; outline: none;">
                    Array(${val.length})
                </summary>
                <div style="border-left: 1px dashed #334155; margin-left: 8px; padding-top: 4px;">
                    ${items}
                </div>
            </details>
        `;
    }

    if (typeof val === "object") {
        const className = val.constructor ? val.constructor.name : "Object";
        let entries: [string, any][] = [];

        if (typeof val.attributes === "object" && val.attributes !== null) {
            entries = Object.entries(val.attributes);
        } else if (typeof val.all === "function") {
            return renderValueToHtml(val.all(), depth);
        } else {
            entries = Object.entries(val);
        }

        if (entries.length === 0) return `<span style="color: #cbd5e1;">${className} {}</span>`;
        if (depth > 6) return `<span style="color: #94a3b8;">${className} {...}</span>`;

        const props = entries.map(([k, v]) => `
            <div style="padding-left: 20px; margin-top: 2px;">
                <span style="color: #facc15;">"${escapeHtml(k)}"</span><span style="color: #cbd5e1;">: </span>${renderValueToHtml(v, depth + 1)}
            </div>
        `).join("");

        return `
            <details ${depth === 0 ? "open" : ""}>
                <summary style="cursor: pointer; color: #60a5fa; font-weight: 600; outline: none;">
                    ${className} <span style="color: #94a3b8; font-weight: normal; font-size: 12px;">(${entries.length} properties)</span>
                </summary>
                <div style="border-left: 1px dashed #334155; margin-left: 8px; padding-top: 4px;">
                    ${props}
                </div>
            </details>
        `;
    }

    return String(val);
}

/**
 * Global dump() helper — dumps variables to console/browser without halting execution
 */
export function dump(...args: any[]): void {
    const caller = getCallerLocation();
    console.log(`\x1b[33m[Dump @ ${caller}]\x1b[0m`);
    for (const arg of args) {
        console.log(util.inspect(arg, { colors: true, depth: 8 }));
    }
}

/**
 * Global dd() helper (Dump & Die) — dumps variables with rich formatting and halts execution
 */
export function dd(...args: any[]): any {
    const caller = getCallerLocation();
    const store = httpContextStorage.getStore() || (globalThis as any).__lastHttpCtx;

    if (store && store.reply) {
        const req = store.request;
        const rep = store.reply;

        const wantsJson = wantsJsonRequest(req);
        if (wantsJson) {
            const err = new HttpException(500, JSON.stringify({
                dd: true,
                caller,
                data: args.length === 1 ? args[0] : args
            }));
            (err as any).__isDd = true;
            (err as any).__isJsonDd = true;
            throw err;
        } else {
            const dumpedContent = args.map(arg => renderValueToHtml(arg)).join('<div style="height: 16px;"></div>');
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>dd() Dump & Die — StruxJS</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background-color: #0f172a;
            color: #f8fafc;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            padding: 30px;
            font-size: 14px;
            line-height: 1.6;
        }
        .dump-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1e293b;
            padding: 14px 24px;
            border-radius: 10px;
            margin-bottom: 24px;
            border: 1px solid #334155;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        .dump-title { font-weight: 700; color: #f43f5e; font-size: 16px; letter-spacing: 0.5px; }
        .dump-location { color: #94a3b8; font-size: 13px; background: #0f172a; padding: 4px 12px; border-radius: 6px; border: 1px solid #334155; }
        .dump-container { background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.4); overflow-x: auto; }
        summary:hover { opacity: 0.85; }
    </style>
</head>
<body>
    <div class="dump-header">
        <div class="dump-title">dd() — Dump & Die</div>
        ${caller ? `<div class="dump-location">${escapeHtml(caller)}</div>` : ''}
    </div>
    <div class="dump-container">
        ${dumpedContent}
    </div>
</body>
</html>`;
            const err = new HttpException(500, html);
            (err as any).__isDd = true;
            throw err;
        }
    } else {
        console.log(`\x1b[31m[dd() Dump & Die @ ${caller}]\x1b[0m`);
        for (const arg of args) {
            console.log(util.inspect(arg, { colors: true, depth: null, maxArrayLength: null }));
        }
        process.exit(1);
    }
}

// Attach dd and dump globally to globalThis for zero-import convenience
(globalThis as any).dump = dump;
(globalThis as any).dd = dd;
