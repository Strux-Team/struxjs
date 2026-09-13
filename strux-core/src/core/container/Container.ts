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
    // Cache for pre-compiled constructor parameter resolution plans
    private planCache: WeakMap<any, ((container: Container) => any)[]> = new WeakMap();

    constructor() {
        (globalThis as any).__STRUXJS_CONTAINER__ = this;
    }

    /**
     * Clear cached dependency injection plans (useful in testing or HMR)
     */
    public clearPlanCache(): void {
        this.planCache = new WeakMap();
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
        // Fast path: use cached constructor resolution plan if available
        const cachedPlan = this.planCache.get(target);
        if (cachedPlan) {
            const dependencies = cachedPlan.map((resolver) => resolver(this));
            return new target(...dependencies);
        }

        // 1. Get types array from metadata
        const constructorParams: any[] = Reflect.getMetadata(PREC_PARAM_TYPES_KEY, target) ||
            Reflect.getMetadata("design:paramtypes", target) || [];

        const injectedTokens: Record<number, any> = Reflect.getMetadata(INJECT_TOKENS_KEY, target) || {};

        // 2. FALLBACK MECHANISM: Parse Constructor string to extract parameter names and metadata via Regex
        // Handles cases where TypeScript loses design types due to asynchronous ES Module loading,
        // as well as classes with default parameters, optional parameters, or rest parameters.
        const constructorStr = target.toString();
        const paramMatch = constructorStr.match(/constructor\s*\(([^)]*)\)/);
        let paramMetas: Array<{
            name: string;
            isRest: boolean;
            hasDefault: boolean;
            isOptional: boolean;
        }> = [];

        if (paramMatch && paramMatch[1]) {
            const rawParams: string[] = [];
            let current = "";
            let depthParen = 0, depthBracket = 0, depthBrace = 0;
            let inQuote: string | null = null;
            const paramContent = paramMatch[1];

            for (let i = 0; i < paramContent.length; i++) {
                const ch = paramContent[i];
                if (inQuote) {
                    if (ch === inQuote && paramContent[i - 1] !== "\\") inQuote = null;
                    current += ch;
                } else if (ch === '"' || ch === "'" || ch === "`") {
                    inQuote = ch;
                    current += ch;
                } else if (ch === "(") { depthParen++; current += ch; }
                else if (ch === ")") { depthParen--; current += ch; }
                else if (ch === "[") { depthBracket++; current += ch; }
                else if (ch === "]") { depthBracket--; current += ch; }
                else if (ch === "{") { depthBrace++; current += ch; }
                else if (ch === "}") { depthBrace--; current += ch; }
                else if (ch === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
                    rawParams.push(current.trim());
                    current = "";
                } else {
                    current += ch;
                }
            }
            if (current.trim()) rawParams.push(current.trim());

            paramMetas = rawParams.map(p => {
                const trimmed = p.trim();
                const isRest = trimmed.startsWith("...");
                const clean = trimmed.replace(/^\.\.\./, "").replace(/^(private|protected|public|readonly)\s+/, "").trim();
                const hasDefault = clean.includes("=");
                const isOptional = clean.includes("?") || hasDefault || isRest;
                const namePart = clean.split(/[:?=]/)[0].trim();

                return {
                    name: namePart,
                    isRest,
                    hasDefault,
                    isOptional
                };
            });
        }

        const maxParams = Math.max(constructorParams.length, Object.keys(injectedTokens).length, paramMetas.length);
        const plan: ((container: Container) => any)[] = [];
        const dependencies: any[] = [];

        for (let index = 0; index < maxParams; index++) {
            // RULE 1: If @Inject('token') is present at this index -> resolve token immediately
            if (injectedTokens[index]) {
                const token = injectedTokens[index];
                plan.push((c) => c.make(token));
                dependencies.push(this.make(token));
                continue;
            }

            // RULE 2: If @Inject is absent, perform intelligent auto-resolution
            const paramType = constructorParams[index];
            const paramMeta = paramMetas[index];
            const paramName = paramMeta ? paramMeta.name : "";
            const isOptional = (paramMeta && (paramMeta.isOptional || paramMeta.hasDefault || paramMeta.isRest)) ||
                (typeof target.length === "number" && index >= target.length);

            // If data type is a valid class and not a primitive or raw Object/Array -> recursively resolve by Class
            if (paramType && paramType !== String && paramType !== Number && paramType !== Boolean && paramType !== Object && paramType !== Array) {
                plan.push((c) => c.make(paramType));
                dependencies.push(this.make(paramType));
                continue;
            }

            let resolved = false;

            // Fallback by parameter name if we have a valid parameter name and not a rest parameter
            if (paramName && !paramMeta?.isRest) {
                const guessedClassName = paramName.charAt(0).toUpperCase() + paramName.slice(1);

                // 1. Try explicit token guesses
                for (const candidate of [guessedClassName, `${guessedClassName}Service`, paramName]) {
                    if (this.bindings.has(candidate)) {
                        plan.push((c) => c.make(candidate));
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
                            plan.push((c) => c.make(key));
                            dependencies.push(this.make(key));
                            resolved = true;
                            break;
                        }
                    }
                }
            }

            if (!resolved) {
                if (isOptional) {
                    // For rest parameters, do not inject an undefined argument
                    if (paramMeta?.isRest) {
                        continue;
                    }
                    // For parameters with default values or optional modifiers, inject undefined to let default value apply
                    plan.push(() => undefined);
                    dependencies.push(undefined);
                } else {
                    const guessedClassName = paramName ? paramName.charAt(0).toUpperCase() + paramName.slice(1) : "Unknown";
                    throw new Error(
                        `[StruxJS IoC Error]: Auto-injection failed for parameter '${paramName || index}' at index [${index}] in Class '${target.name}'. ` +
                        `Framework tried to fallback to token '${guessedClassName}' but it was not registered.`
                    );
                }
            }
        }

        // Cache the compiled resolution plan
        this.planCache.set(target, plan);

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
