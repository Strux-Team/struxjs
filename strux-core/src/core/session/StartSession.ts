import { Middleware } from "../http/Middleware.js";
import { FastifyRequest, FastifyReply } from "fastify";
import { SessionStore } from "./SessionStore.js";

const COOKIE_NAME = "struxjs_session";

export class StartSession implements Middleware {
    public async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        const cookies = (request as any).cookies || {};
        let sessionId = cookies[COOKIE_NAME];

        const sessionStore = new SessionStore(sessionId);
        await sessionStore.load();

        const origRegenerate = sessionStore.regenerate.bind(sessionStore);
        sessionStore.regenerate = () => {
            const newId = origRegenerate();
            reply.setCookie(COOKIE_NAME, newId, {
                path: "/",
                httpOnly: true,
                sameSite: "lax"
            });
            return newId;
        };

        (request as any).sessionInstance = sessionStore;

        if (sessionStore.getId() !== sessionId) {
            reply.setCookie(COOKIE_NAME, sessionStore.getId(), {
                path: "/",
                httpOnly: true,
                sameSite: "lax"
            });
        }

        reply.raw.on("finish", async () => {
            await sessionStore.save();
        });
    }
}
