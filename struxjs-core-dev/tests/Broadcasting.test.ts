import { describe, test, expect, beforeEach } from "vitest";
import { 
    Broadcast, 
    LogBroadcaster, 
    MemoryBroadcaster, 
    Event, 
    EventDispatcher, 
    ShouldBroadcast 
} from "../src/index.js";

class OrderShippedEvent extends Event implements ShouldBroadcast {
    constructor(public orderId: number, public trackingCode: string) {
        super();
    }

    public broadcastOn(): string | string[] {
        return ["orders", `order.${this.orderId}`];
    }

    public broadcastAs(): string {
        return "OrderShipped";
    }

    public broadcastWith(): Record<string, any> {
        return {
            id: this.orderId,
            tracking: this.trackingCode,
            status: "shipped"
        };
    }
}

describe("WebSocket & Broadcasting System", () => {
    beforeEach(() => {
        Broadcast.useDriver("memory");
    });

    test("broadcasts payload to channels using LogBroadcaster", async () => {
        const logBroadcaster = Broadcast.getLogBroadcaster();
        logBroadcaster.clear();

        Broadcast.setBroadcaster(logBroadcaster);

        await Broadcast.to(["chat.room.1", "notifications"]).emit("UserTyping", { user: "Alex" });

        expect(logBroadcaster.logs).toHaveLength(1);
        expect(logBroadcaster.logs[0].eventName).toBe("UserTyping");
        expect(logBroadcaster.logs[0].channels).toEqual(["chat.room.1", "notifications"]);
        expect(logBroadcaster.logs[0].payload).toEqual({ user: "Alex" });
    });

    test("manages client channel subscriptions in MemoryBroadcaster", () => {
        const memoryBroadcaster = Broadcast.getMemoryBroadcaster();
        const fakeSocket: any = { readyState: 1, send: () => {} };

        const client = memoryBroadcaster.registerClient("client_1", fakeSocket);
        expect(memoryBroadcaster.getConnectedClientsCount()).toBe(1);

        memoryBroadcaster.subscribe("client_1", "chat.room.1");
        expect(memoryBroadcaster.getSubscribersCount("chat.room.1")).toBe(1);

        memoryBroadcaster.unsubscribe("client_1", "chat.room.1");
        expect(memoryBroadcaster.getSubscribersCount("chat.room.1")).toBe(0);

        memoryBroadcaster.removeClient("client_1");
        expect(memoryBroadcaster.getConnectedClientsCount()).toBe(0);
    });

    test("automatically broadcasts events implementing ShouldBroadcast on Event.dispatch", async () => {
        const logBroadcaster = Broadcast.getLogBroadcaster();
        logBroadcaster.clear();
        Broadcast.setBroadcaster(logBroadcaster);

        const orderEvent = new OrderShippedEvent(42, "TRACK123");
        await EventDispatcher.dispatch(orderEvent);

        expect(logBroadcaster.logs).toHaveLength(1);
        expect(logBroadcaster.logs[0].eventName).toBe("OrderShipped");
        expect(logBroadcaster.logs[0].channels).toEqual(["orders", "order.42"]);
        expect(logBroadcaster.logs[0].payload).toEqual({
            id: 42,
            tracking: "TRACK123",
            status: "shipped"
        });
    });

    test("authorizes private channels using pattern callbacks", async () => {
        Broadcast.authorizeChannel("chat.room.:id", (user, roomId) => {
            return user && user.id === 1 && roomId === "100";
        });

        const user1 = { id: 1, name: "Alex" };
        const user2 = { id: 2, name: "Bob" };

        expect(await Broadcast.isChannelAuthorized(user1, "chat.room.100")).toBe(true);
        expect(await Broadcast.isChannelAuthorized(user2, "chat.room.100")).toBe(false);
        expect(await Broadcast.isChannelAuthorized(user1, "chat.room.999")).toBe(false);
    });

    test("authorizes private user channel by default", async () => {
        const user = { id: "user_42" };

        expect(await Broadcast.isChannelAuthorized(user, "private-user.user_42")).toBe(true);
        expect(await Broadcast.isChannelAuthorized(user, "private-user.user_99")).toBe(false);
    });

    test("automatically broadcasts model CRUD events when broadcastEvents is enabled", async () => {
        const { BaseModel } = await import("../src/index.js");

        class BroadcastableProduct extends BaseModel {
            protected table = "products";
            protected broadcastEvents = true;
        }

        const logBroadcaster = Broadcast.getLogBroadcaster();
        logBroadcaster.clear();
        Broadcast.setBroadcaster(logBroadcaster);

        const product = new BroadcastableProduct({ id: 99, title: "Smart Watch" });
        await product.dispatchModelBroadcast("created");

        expect(logBroadcaster.logs).toHaveLength(1);
        expect(logBroadcaster.logs[0].eventName).toBe("BroadcastableProductCreated");
        expect(logBroadcaster.logs[0].channels).toEqual(["products"]);
        expect(logBroadcaster.logs[0].payload.action).toBe("created");
        expect(logBroadcaster.logs[0].payload.model.title).toBe("Smart Watch");
    });
});
