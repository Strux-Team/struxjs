import { Auth } from "./Auth.js";
import { AuthorizationError } from "./AuthorizationError.js";
import { HasRoles } from "./HasRoles.js";

export type GateCallback = (user: any, ...args: any[]) => boolean | Promise<boolean>;
export type BeforeHook = (user: any, ability: string, ...args: any[]) => boolean | undefined | Promise<boolean | undefined>;
export type AfterHook = (user: any, ability: string, result: boolean, ...args: any[]) => boolean | undefined | Promise<boolean | undefined>;

export class UserGateEvaluator {
    constructor(private user: any) {}

    public async allows(ability: string, ...args: any[]): Promise<boolean> {
        return Gate.evaluateForUser(this.user, ability, ...args);
    }

    public async denies(ability: string, ...args: any[]): Promise<boolean> {
        return !(await this.allows(ability, ...args));
    }

    public async authorize(ability: string, ...args: any[]): Promise<boolean> {
        const allowed = await this.allows(ability, ...args);
        if (!allowed) {
            throw new AuthorizationError(`This action (${ability}) is unauthorized.`, ability);
        }
        return true;
    }
}

export class Gate {
    private static abilities: Map<string, GateCallback> = new Map();
    private static policies: Map<any, any> = new Map();
    private static beforeHooks: BeforeHook[] = [];
    private static afterHooks: AfterHook[] = [];

    /**
     * Define a named authorization gate callback
     *
     * Gate.define('edit-post', (user, post) => user.id === post.userId);
     */
    public static define(ability: string, callback: GateCallback): typeof Gate {
        this.abilities.set(ability, callback);
        return this;
    }

    /**
     * Register a policy class for a target model constructor
     *
     * Gate.policy(Post, PostPolicy);
     */
    public static policy(modelClass: any, policyClass: any): typeof Gate {
        this.policies.set(modelClass, policyClass);
        return this;
    }

    /**
     * Register a callback to run before all other gate checks
     * Returning a boolean short-circuits evaluation.
     *
     * Gate.before((user, ability) => {
     *     if (user.isSuperAdmin) return true;
     * });
     */
    public static before(callback: BeforeHook): typeof Gate {
        this.beforeHooks.push(callback);
        return this;
    }

    /**
     * Register a callback to run after gate checks
     */
    public static after(callback: AfterHook): typeof Gate {
        this.afterHooks.push(callback);
        return this;
    }

    /**
     * Scope gate evaluations to a specific user instance
     */
    public static forUser(user: any): UserGateEvaluator {
        return new UserGateEvaluator(user);
    }

    /**
     * Evaluate if an ability is allowed for the currently authenticated user
     */
    public static async allows(ability: string, ...args: any[]): Promise<boolean> {
        const user = await this.resolveCurrentUser();
        return this.evaluateForUser(user, ability, ...args);
    }

    /**
     * Evaluate if an ability is denied for the currently authenticated user
     */
    public static async denies(ability: string, ...args: any[]): Promise<boolean> {
        return !(await this.allows(ability, ...args));
    }

    /**
     * Authorize an ability for the current user or throw an AuthorizationError
     */
    public static async authorize(ability: string, ...args: any[]): Promise<boolean> {
        const allowed = await this.allows(ability, ...args);
        if (!allowed) {
            throw new AuthorizationError(`This action (${ability}) is unauthorized.`, ability);
        }
        return true;
    }

    /**
     * Evaluate authorization ability for a specific user instance
     */
    public static async evaluateForUser(user: any, ability: string, ...args: any[]): Promise<boolean> {
        // 1. Run before hooks
        for (const hook of this.beforeHooks) {
            const beforeResult = await hook(user, ability, ...args);
            if (typeof beforeResult === "boolean") {
                return this.runAfterHooks(user, ability, beforeResult, ...args);
            }
        }

        let result: boolean = false;

        // 2. Check if first argument is a model instance or policy target
        const targetObject = args[0];

        if (targetObject && typeof targetObject === "object") {
            const modelConstructor = targetObject.constructor;

            if (this.policies.has(modelConstructor)) {
                const PolicyClass = this.policies.get(modelConstructor);
                const policyInstance = typeof PolicyClass === "function" ? new PolicyClass() : PolicyClass;

                // CamelCase ability name mapping (e.g. 'view-any' -> 'viewAny', 'create' -> 'create')
                const methodName = this.toCamelCase(ability);

                if (typeof policyInstance[methodName] === "function") {
                    result = Boolean(await policyInstance[methodName](user, ...args));
                    return this.runAfterHooks(user, ability, result, ...args);
                }
            }
        }

        // 3. Check defined explicit gate abilities
        if (this.abilities.has(ability)) {
            const callback = this.abilities.get(ability)!;
            result = Boolean(await callback(user, ...args));
            return this.runAfterHooks(user, ability, result, ...args);
        }

        // 4. Default RBAC check: check if user has direct permission or role matching ability name
        if (user) {
            if (HasRoles.hasPermissionTo(user, ability) || HasRoles.hasRole(user, ability)) {
                result = true;
            }
        }

        return this.runAfterHooks(user, ability, result, ...args);
    }

    /**
     * Reset all registered gates, policies, and hooks (useful between tests)
     */
    public static reset(): void {
        this.abilities.clear();
        this.policies.clear();
        this.beforeHooks = [];
        this.afterHooks = [];
    }

    private static async runAfterHooks(user: any, ability: string, result: boolean, ...args: any[]): Promise<boolean> {
        let finalResult = result;
        for (const hook of this.afterHooks) {
            const afterResult = await hook(user, ability, finalResult, ...args);
            if (typeof afterResult === "boolean") {
                finalResult = afterResult;
            }
        }
        return finalResult;
    }

    private static async resolveCurrentUser(): Promise<any> {
        try {
            return await Auth.user();
        } catch {
            return null;
        }
    }

    private static toCamelCase(str: string): string {
        return str.replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase());
    }
}
