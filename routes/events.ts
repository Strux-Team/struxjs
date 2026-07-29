import { EventDispatcher } from "struxjs";
import { UserRegistered } from "../app/Events/UserRegistered.js";
import { SendWelcomeEmail } from "../app/Listeners/SendWelcomeEmail.js";

/**
 * routes/events.ts — Event & Listener mappings.
 *
 * Register your events and their listeners here.
 * This file is loaded automatically during application bootstrap.
 *
 * Usage:
 *
 *   import { UserRegistered } from "../app/Events/UserRegistered.js";
 *   import { SendWelcomeEmail } from "../app/Listeners/SendWelcomeEmail.js";
 *   import { LogUserActivity } from "../app/Listeners/LogUserActivity.js";
 *
 *   EventDispatcher.listen(UserRegistered, [
 *       SendWelcomeEmail,
 *       LogUserActivity,
 *   ]);
 *
 * Wildcard — fires for every event:
 *
 *   EventDispatcher.on("*", async (event) => {
 *       console.log("Event fired:", event.constructor.name);
 *   });
 *
 * Queued listener (runs in background):
 *   export class SendWelcomeEmail extends Listener {
 *       public shouldQueue = true;
 *       public queue       = "emails";
 *       public async handle(event: UserRegistered) { ... }
 *   }
 */

export default function (): void {
  // Register your event listeners here
}
