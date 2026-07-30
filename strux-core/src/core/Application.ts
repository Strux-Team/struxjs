// src/core/Application.ts (Core engine)
import { Container } from "./container/Container.js";
import { ConfigManager, config } from "./config/Config.js";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { FormRequest } from "./validation/FormRequest.js"; // Core milestone tracker

export class Application {
    public container: Container;
    private providers: any[] = [];
    private scannedProviders: any[] = [];

    constructor(private appRootPath: string) {
        this.container = new Container();
    }

    /**
     * Register system network and service providers array
     */
    public registerProviders(providers: any[]): void {
        this.providers = providers.map(ProviderClass => new ProviderClass(this.container));
    }

    /**
     * Boot the core ecosystem components sequentially
     */
    public async bootstrap(): Promise<void> {
        // Phase 1: Load configurations and .env mappings into storage variables
        const configManager = new ConfigManager(this.container);
        await configManager.load(this.appRootPath);

        // Configure system timezone from app.timezone config or APP_TIMEZONE env
        const appTimezone = config("app.timezone") || process.env.APP_TIMEZONE || process.env.TZ || "UTC";
        process.env.TZ = appTimezone;

        // Phase 2: AUTOMATIC DEEP DIRECTORY SCANNING AND IOC BINDINGS REGISTRY
        // Register core framework middleware aliases
        const { VerifyCsrfToken } = await import("./security/VerifyCsrfToken.js");
        const { StartSession } = await import("./session/StartSession.js");
        const { ThrottleRequests } = await import("./security/ThrottleRequests.js");
        this.container.bind("csrf", (c) => c.make(VerifyCsrfToken));
        this.container.bind("session", (c) => c.make(StartSession));
        this.container.bind("throttle", (c) => c.make(ThrottleRequests));

        // We register Requests first to guarantee Router can resolve them during route compilation bounds
        await this.scanAndBindRequests();
        await this.scanAndBindServices();
        await this.scanAndBindControllers();
        await this.scanAndBindMiddlewares();
        await this.scanAndRegisterProviders();
        await this.scanAndRegisterJobs();

        // Phase 3: Execute boot cycle for all scanned custom app Providers
        for (const provider of this.scannedProviders) {
            if (typeof provider.boot === "function") {
                await provider.boot(this.container);
            }
        }

        // Phase 4: Execute the register cycle on all registered service drivers
        for (const provider of this.providers) {
            if (typeof provider.register === "function") {
                provider.register();
            }
        }
    }

    /**
     * Helper Utility: Recursively walks through any folder to gather all JS/TS script paths
     */
    private getFilesRecursive(dirPath: string): string[] {
        let filesToReturn: string[] = [];
        if (!fs.existsSync(dirPath)) return filesToReturn;

        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                // Recursively plunge down inside child namespaces folders
                filesToReturn = filesToReturn.concat(this.getFilesRecursive(fullPath));
            } else if (file.endsWith(".ts") || file.endsWith(".js")) {
                filesToReturn.push(fullPath);
            }
        }

        return filesToReturn;
    }

    /**
     * RECURSIVE SCANNER: Automatically loads and injects all custom FormRequest validators into IoC
     */
    private async scanAndBindRequests(): Promise<void> {
        const requestsDir = path.join(this.appRootPath, "app", "Requests");
        if (!fs.existsSync(requestsDir)) return;

        const allFiles = this.getFilesRecursive(requestsDir);

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            // Extract any class within the file module context inheriting the FormRequest architecture
            const RequestClass = Object.values(module).find(
                (exportedItem) => typeof exportedItem === "function" && exportedItem.prototype instanceof FormRequest
            ) as any;

            if (RequestClass) {
                // Freeze registration key into container bindings map using the concrete constructor class type
                this.container.singleton(RequestClass, (c) => new RequestClass());
            }
        }
    }

    /**
     * RECURSIVE SCANNER: Automatically registers dynamic Singleton Services classes
     */
    private async scanAndBindServices(): Promise<void> {
        const servicesDir = path.join(this.appRootPath, "app", "Services");
        if (!fs.existsSync(servicesDir)) return;

        const allFiles = this.getFilesRecursive(servicesDir);

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            const ServiceClass = Object.values(module).find(
                (exportedItem) => typeof exportedItem === "function" && exportedItem.name.endsWith("Service")
            ) as any;

            if (ServiceClass) {
                this.container.singleton(ServiceClass, (c) => c.resolve(ServiceClass));
                this.container.singleton(ServiceClass.name, (c) => c.make(ServiceClass));
            }
        }
    }

    /**
     * RECURSIVE SCANNER: Automatically resolves, bounds, and groups controllers into namespaced tokens
     */
    private async scanAndBindControllers(): Promise<void> {
        const controllersDir = path.join(this.appRootPath, "app", "Controllers");
        const allFiles = this.getFilesRecursive(controllersDir);

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            const ControllerClass = Object.values(module).find(
                (exportedItem) => typeof exportedItem === "function" && exportedItem.name.endsWith("Controller")
            ) as any;

            if (ControllerClass) {
                const relativePath = path.relative(controllersDir, filePath);
                const dirInfo = path.parse(relativePath).dir;

                const tokenName = dirInfo
                    ? `${dirInfo}/${ControllerClass.name}`
                    : ControllerClass.name;

                this.container.bind(tokenName, (c) => c.make(ControllerClass));
            }
        }
    }

    /**
     * RECURSIVE SCANNER: Automatically extracts, cleans, and binds HTTP gates middlewares
     */
    private async scanAndBindMiddlewares(): Promise<void> {
        const middlewaresDir = path.join(this.appRootPath, "app", "Middleware");
        const allFiles = this.getFilesRecursive(middlewaresDir);

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            const MiddlewareClass = Object.values(module).find(
                (exportedItem) => typeof exportedItem === "function" && exportedItem.name.endsWith("Middleware")
            ) as any;

            if (MiddlewareClass) {
                const relativePath = path.relative(middlewaresDir, filePath);
                const dirInfo = path.parse(relativePath).dir;

                const baseName = MiddlewareClass.name.replace("Middleware", "").toLowerCase();
                const tokenName = dirInfo ? `${dirInfo.toLowerCase()}/${baseName}` : baseName;

                this.container.bind(tokenName, (c) => c.make(MiddlewareClass));
            }
        }
    }

    /**
     * RECURSIVE SCANNER: Automatically loads and executes all custom Service Providers in app/Providers
     */
    private async scanAndRegisterProviders(): Promise<void> {
        const providersDir = path.join(this.appRootPath, "app", "Providers");
        if (!fs.existsSync(providersDir)) return;

        const allFiles = this.getFilesRecursive(providersDir);

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function") {
                    try {
                        const providerInstance = new (exportedItem as any)();
                        this.scannedProviders.push(providerInstance);

                        if (typeof providerInstance.register === "function") {
                            providerInstance.register(this.container);
                        }
                    } catch (e) {
                        // Ignore non-instantiable functions
                    }
                }
            }
        }
    }

    /**
     * RECURSIVE SCANNER: Automatically loads all Job classes and registers them
     */
    private async scanAndRegisterJobs(): Promise<void> {
        const jobsDir = path.join(this.appRootPath, "app", "Jobs");
        if (!fs.existsSync(jobsDir)) return;

        const allFiles = this.getFilesRecursive(jobsDir);
        // Ensure Job is imported
        const { Job } = await import("./queue/Job.js");

        for (const filePath of allFiles) {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);

            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function" && exportedItem.name.endsWith("Job")) {
                    Job.register(exportedItem as any);
                }
            }
        }
    }

    /**
     * Activate the network engine driver and launch listening hooks channels
     */
    public async start(): Promise<void> {
        for (const provider of this.providers) {
            if (typeof provider.boot === "function") {
                await provider.boot(this.container);
            }
        }
    }
}
