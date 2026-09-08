import { describe, test, expect, beforeEach } from "vitest";
import { Container, Inject, Injectable, make } from "../src/index.js";

class MockDatabaseService {
    public name = "SQLite";
}

class UserRepository {
    constructor(public db: MockDatabaseService) {}
}

class InjectParamService {
    constructor(@Inject("db.name") public dbName: string) {}
}

class AppConfig {
    @Inject("config.app_name")
    public appName!: string;
}

describe("IoC Container", () => {
    let container: Container;

    beforeEach(() => {
        container = new Container();
    });

    test("bind transient service returns new instance each time", () => {
        let count = 0;
        container.bind("counter", () => ++count);

        expect(container.make("counter")).toBe(1);
        expect(container.make("counter")).toBe(2);
    });

    test("singleton service returns same instance each time", () => {
        container.singleton("service", () => ({ id: Math.random() }));

        const instance1 = container.make("service");
        const instance2 = container.make("service");

        expect(instance1).toBe(instance2);
    });

    test("make throws error for unregistered token", () => {
        expect(() => container.make("unknown")).toThrow("not found in container");
    });

    test("resolves class dependencies automatically with @Injectable", () => {
        container.bind(MockDatabaseService, () => new MockDatabaseService());

        const repo = container.make<UserRepository>(UserRepository);
        expect(repo).toBeInstanceOf(UserRepository);
        expect(repo.db.name).toBe("SQLite");
    });

    test("resolves parameter with @Inject token decorator", () => {
        container.bind("db.name", () => "PostgresDB");

        const dbService = container.resolve<InjectParamService>(InjectParamService);
        expect(dbService.dbName).toBe("PostgresDB");
    });

    test("injects property via @Inject property decorator", () => {
        container.bind("config.app_name", () => "StruxJS App");

        const appConfig = new AppConfig();
        expect(appConfig.appName).toBe("StruxJS App");
    });

    test("global make helper function works after container is booted", () => {
        container.bind("test.value", () => 42);

        expect(make("test.value")).toBe(42);
    });

    test("caches constructor dependency resolution plan for transient classes", () => {
        container.bind(MockDatabaseService, () => new MockDatabaseService());

        // First resolve: compiles plan and caches it
        const repo1 = container.resolve<UserRepository>(UserRepository);
        expect(repo1).toBeInstanceOf(UserRepository);
        expect(repo1.db.name).toBe("SQLite");

        // Second resolve: uses cached plan
        const repo2 = container.resolve<UserRepository>(UserRepository);
        expect(repo2).toBeInstanceOf(UserRepository);
        expect(repo2.db.name).toBe("SQLite");
        expect(repo1).not.toBe(repo2); // Fresh instance because resolve() was called, but using cached plan

        // clearPlanCache resets the plan cache without breaking subsequent resolution
        container.clearPlanCache();
        const repo3 = container.resolve<UserRepository>(UserRepository);
        expect(repo3).toBeInstanceOf(UserRepository);
    });
});
