import { describe, test, expect, beforeEach } from "vitest";
import { EventDispatcher, Event, Listener, event } from "../src/index.js";

class UserRegistered extends Event {
    constructor(public userId: number) {
        super();
    }
}

class WelcomeListener extends Listener {
    public static handledUserIds: number[] = [];

    public async handle(ev: UserRegistered): Promise<void> {
        WelcomeListener.handledUserIds.push(ev.userId);
    }
}

describe("EventDispatcher", () => {
    beforeEach(() => {
        EventDispatcher.flush();
        WelcomeListener.handledUserIds = [];
    });

    test("listens and dispatches event to Listener class", async () => {
        EventDispatcher.listen(UserRegistered, [WelcomeListener]);
        await event(new UserRegistered(101));

        expect(WelcomeListener.handledUserIds).toEqual([101]);
    });

    test("listens and dispatches event to callback function", async () => {
        const received: number[] = [];
        EventDispatcher.on(UserRegistered, (ev: UserRegistered) => {
            received.push(ev.userId);
        });

        await EventDispatcher.dispatch(new UserRegistered(202));
        expect(received).toEqual([202]);
    });

    test("wildcard listener receives all events", async () => {
        const received: string[] = [];
        EventDispatcher.listen("*", [
            async (ev: any) => {
                received.push(ev.constructor.name);
            },
        ]);

        await EventDispatcher.dispatch(new UserRegistered(303));
        expect(received).toEqual(["UserRegistered"]);
    });
});
