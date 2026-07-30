import "reflect-metadata";
import { INJECT_TOKENS_KEY, PREC_PARAM_TYPES_KEY } from "./Inject.js";

export type BindingCallback = (container: Container) => any;

interface Binding {
    callback: BindingCallback;
    singleton: boolean;
    instance?: any; // Stores the single instance if it is a singleton binding
}

export class Container {
    // Master map to manage all string tokens and manual registrations
    private bindings: Map<any, Binding> = new Map();

    constructor() {
        (globalThis as any).__STRUXJS_CONTAINER__ = this;
    }

    /**
     * Register a transient service (A fresh instance is created every time 'make' is called)
     */
    public bind(key: any, callback: BindingCallback): void {
        this.bindings.set(key, { callback, singleton: false });
    }

    /**
     * Register a singleton service (Only initialized once throughout the application lifecycle)
     */
    public singleton(key: any, callback: BindingCallback): void {
        this.bindings.set(key, { callback, singleton: true });
    }

    /**
     * Resolve and instantiate the requested service or class from the container
     */
    public make<T = any>(target: any): T {
        // Case 1: If target is a String or Symbol token, resolve it directly from custom bindings map
        if (typeof target === "string" || typeof target === "symbol") {
            const binding = this.bindings.get(target);
            if (!binding) {
                throw new Error(`[StruxJS IoC Error]: Binding token '${String(target)}' not found in container.`);
            }

            if (binding.singleton && binding.instance !== undefined) {
                return binding.instance;
            }

            const instance = binding.callback(this);
            if (binding.singleton) {
                binding.instance = instance;
            }
            return instance;
        }

        // Case 2: If target is a Class Constructor function
        if (typeof target === "function") {
            // CRITICAL FIX: If this Class has not been registered in the Container yet,
            // automatically register it as a Singleton on first call!
            if (!this.bindings.has(target)) {
                this.singleton(target, (c) => c.resolve(target));
            }

            // Once guaranteed that Class is bound, invoke the Class token to retrieve the Singleton instance
            const binding = this.bindings.get(target)!;
            if (binding.instance !== undefined) {
                return binding.instance;
            }

            const instance = binding.callback(this);
            binding.instance = instance;
            return instance;
        }

        throw new Error("[StruxJS IoC Error]: Invalid target type passed to container.make().");
    }

    /**
     * Automatically inspect parameter index maps and recursively inject constructor dependencies
     */
    public resolve<T>(target: any): T {
        // 1. Get types array from metadata
        const constructorParams: any[] = Reflect.getMetadata(PREC_PARAM_TYPES_KEY, target) ||
            Reflect.getMetadata("design:paramtypes", target) || [];

        const injectedTokens: Record<number, any> = Reflect.getMetadata(INJECT_TOKENS_KEY, target) || {};

        // 2. FALLBACK MECHANISM: Parse Constructor string to extract parameter names via Regex
        // Handles cases where TypeScript loses design types due to asynchronous ES Module loading
        const constructorStr = target.toString();
        const paramMatch = constructorStr.match(/constructor\s*\(([^)]*)\)/);
        let paramNames: string[] = [];

        if (paramMatch && paramMatch[1]) {
            paramNames = paramMatch[1]
                .split(",")
                .map((name: string) => {
                    // Strip private, protected, public, readonly modifiers and underscores
                    return name.replace(/(private|protected|public|readonly|\s)/g, "").split(":")[0].trim();
                });
        }

        const maxParams = Math.max(constructorParams.length, Object.keys(injectedTokens).length, paramNames.length);
        const dependencies: any[] = [];

        for (let index = 0; index < maxParams; index++) {
            // RULE 1: If @Inject('token') is present at this index -> resolve token immediately
            if (injectedTokens[index]) {
                dependencies.push(this.make(injectedTokens[index]));
            }
            // RULE 2: If @Inject is absent, perform intelligent auto-resolution
            else {
                const paramType = constructorParams[index];
                const paramName = paramNames[index]; // Actual parameter name (e.g. 'userService')

                // If data type is valid and not raw Object/undefined -> recursively resolve by Class
                if (paramType && paramType !== String && paramType !== Number && paramType !== Boolean && paramType !== Object && paramType !== Array) {
                    dependencies.push(this.make(paramType));
                }
                // IF TYPESCRIPT RETURNS UNDEFINED OR OBJECT DUE TO FILE LOADING ORDER:
                // Fallback by parameter name! Capitalize the first letter to locate the Class
                else if (paramName) {
                    const guessedClassName = paramName.charAt(0).toUpperCase() + paramName.slice(1);
                    let resolved = false;

                    // 1. Try explicit token guesses
                    for (const candidate of [guessedClassName, `${guessedClassName}Service`, paramName]) {
                        if (this.bindings.has(candidate)) {
                            dependencies.push(this.make(candidate));
                            resolved = true;
                            break;
                        }
                    }

                    // 2. Search registered bindings for matching class name or string token
                    if (!resolved) {
                        for (const key of this.bindings.keys()) {
                            const keyName = typeof key === "function" ? key.name : String(key);
                            const cleanKey = keyName.toLowerCase();
                            const cleanParam = paramName.toLowerCase();
                            const capitals = keyName.replace(/[^A-Z]/g, "").toLowerCase();

                            const isMatch = cleanKey === cleanParam ||
                                cleanKey === `${cleanParam}service` ||
                                cleanKey.includes(cleanParam) ||
                                (cleanParam === "db" && cleanKey.includes("database")) ||
                                (capitals.length >= 2 && (capitals === cleanParam || capitals.endsWith(cleanParam)));

                            if (isMatch) {
                                dependencies.push(this.make(key));
                                resolved = true;
                                break;
                            }
                        }
                    }

                    if (!resolved) {
                        throw new Error(
                            `[StruxJS IoC Error]: Auto-injection failed for parameter '${paramName}' at index [${index}] in Class '${target.name}'. ` +
                            `Framework tried to fallback to token '${guessedClassName}' but it was not registered.`
                        );
                    }
                } else {
                    throw new Error(`[StruxJS IoC Error]: Fatal injection error at index [${index}] in Class '${target.name}'.`);
                }
            }
        }

        return new target(...dependencies);
    }

    /**
     * Check if a specific token or class is registered within the container
     */
    public has(key: any): boolean {
        return this.bindings.has(key);
    }
}

/**
 * Helper function to dynamically resolve any binding or class from the global IoC container anywhere
 */
export function make<T = any>(target: any): T {
    const globalContainer = (globalThis as any).__STRUXJS_CONTAINER__;
    if (!globalContainer) {
        throw new Error("[StruxJS IoC Error]: Global application container is not booted yet.");
    }
    return globalContainer.make(target);
}
