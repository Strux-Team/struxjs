import { Container } from "../container/Container.js";
import { Router } from "../http/Router.js";
import { WebSocketServer } from "./WebSocketServer.js";

export class WebSocketServiceProvider {
    constructor(protected container: Container) {}

    public register(): void {
        // Register WebSocket services in container if needed
    }

    public async boot(): Promise<void> {
        const router = this.container.make<Router>("router");
        const fastify = router.getEngine();
        await WebSocketServer.attach(fastify);
    }
}
