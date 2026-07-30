import { Auth, Container, Gate, TemplateEngine, Broadcast } from "struxjs";
import { User } from "../Models/User.js";

export class AppServiceProvider {

    //Register IoC bindings, string tokens, and 3rd party SDKs
    public register(container: Container): void {
        // Register custom string token bindings
        // Example: Register 3rd party SDKs or custom services
        // container.singleton("stripe", (c) => new Stripe(process.env.STRIPE_SECRET));
        // container.singleton("redis", (c) => new RedisClient(process.env.REDIS_URL));

        Auth.extend("web", User);
        Auth.extend("api", User);
        Auth.configureJwt({
            secret: process.env.JWT_SECRET,
            ttl: 3600,           // access token TTL in seconds (default: 3600)
            refreshTtl: 604800,  // refresh token TTL (default: 7 days)
            rotation: true,      // issue a new refresh token on every refresh (optional)
        });

        // Configure Broadcasting driver (select based on your deployment)
        Broadcast.useDriver("memory");
    }

    //Execute boot logic after ALL services & providers are bound to IoC
    public async boot(container: Container): Promise<void> {

    }
}
