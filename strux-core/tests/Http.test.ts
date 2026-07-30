import { describe, test, expect, beforeEach } from "vitest";
import { Container, Router, Route } from "../src/index.js";

describe("HTTP Routing & Dispatching", () => {
    let container: Container;
    let router: Router;

    beforeEach(() => {
        container = new Container();
        router = new Router(container);
        Route.clear();
        Route.setRouter(router);
    });

    test("registers GET and POST routes and processes requests", async () => {
        Route.get("/hello", async () => {
            return "Hello World";
        });

        Route.post("/users", async (req: any) => {
            return { status: "created", name: req.body.name };
        });

        const resGet = await router.getEngine().inject({
            method: "GET",
            url: "/hello",
        });

        expect(resGet.statusCode).toBe(200);
        expect(resGet.payload).toBe("Hello World");

        const resPost = await router.getEngine().inject({
            method: "POST",
            url: "/users",
            payload: { name: "Alice" },
        });

        expect(resPost.statusCode).toBe(200);
        expect(JSON.parse(resPost.payload)).toEqual({ status: "created", name: "Alice" });
    });

    test("extracts route parameters from URL", async () => {
        Route.get("/users/:id/posts/:slug", async (req: any) => {
            return { id: req.params.id, slug: req.params.slug };
        });

        const res = await router.getEngine().inject({
            method: "GET",
            url: "/users/42/posts/hello-world",
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.payload)).toEqual({
            id: "42",
            slug: "hello-world",
        });
    });

    test("handles route groups with prefixes", async () => {
        Route.prefix("/api/v1").group(() => {
            Route.get("/status", async () => {
                return { status: "online" };
            });
        });

        const res = await router.getEngine().inject({
            method: "GET",
            url: "/api/v1/status",
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.payload)).toEqual({ status: "online" });
    });

    test("returns 404 for unknown route", async () => {
        const res = await router.getEngine().inject({
            method: "GET",
            url: "/non-existent",
        });

        expect(res.statusCode).toBe(404);
    });

    test("supports response.redirect().route() and with() flash session chaining", async () => {
        Route.get("/dashboard", async () => "Dashboard Page").name("dashboard");

        Route.get("/users/show/:id", async (req: any) => `User ${req.params.id}`).name("users.show");

        Route.post("/login", async (req: any, res: any) => {
            return res.redirect().route("dashboard").with("success", "Welcome back!");
        });

        Route.post("/update-profile/:id", async (req: any, res: any) => {
            return res.redirect().route("users.show", { id: req.params.id }).with("status", "Profile updated");
        });

        const res1 = await router.getEngine().inject({
            method: "POST",
            url: "/login",
        });

        expect(res1.statusCode).toBe(302);
        expect(res1.headers.location).toBe("/dashboard");

        const res2 = await router.getEngine().inject({
            method: "POST",
            url: "/update-profile/42",
        });

        expect(res2.statusCode).toBe(302);
        expect(res2.headers.location).toBe("/users/show/42");
    });

    test("supports direct response.redirect('/path') and response.redirect('/path', 301)", async () => {
        Route.get("/direct-redirect", async (req: any, res: any) => {
            return res.redirect("/target-page");
        });

        Route.get("/custom-code-redirect", async (req: any, res: any) => {
            return res.redirect("/permanent-page", 301);
        });

        Route.get("/chained-direct-redirect", async (req: any, res: any) => {
            return res.redirect("/welcome").with("msg", "hello");
        });

        const res1 = await router.getEngine().inject({
            method: "GET",
            url: "/direct-redirect"
        });
        expect(res1.statusCode).toBe(302);
        expect(res1.headers.location).toBe("/target-page");

        const res2 = await router.getEngine().inject({
            method: "GET",
            url: "/custom-code-redirect"
        });
        expect(res2.statusCode).toBe(301);
        expect(res2.headers.location).toBe("/permanent-page");

        const res3 = await router.getEngine().inject({
            method: "GET",
            url: "/chained-direct-redirect"
        });
        expect(res3.statusCode).toBe(302);
        expect(res3.headers.location).toBe("/welcome");
    });

    test("supports global redirect() helper function", async () => {
        const { redirect } = await import("../src/index.js");

        Route.get("/dashboard", async () => "Dashboard Page").name("dashboard");

        Route.get("/global-redirect-path", async () => {
            return redirect("/home");
        });

        Route.get("/global-redirect-route", async () => {
            return redirect().route("dashboard").with("status", "welcome");
        });

        const res1 = await router.getEngine().inject({
            method: "GET",
            url: "/global-redirect-path"
        });
        expect(res1.statusCode).toBe(302);
        expect(res1.headers.location).toBe("/home");

        const res2 = await router.getEngine().inject({
            method: "GET",
            url: "/global-redirect-route"
        });
        expect(res2.statusCode).toBe(302);
        expect(res2.headers.location).toBe("/dashboard");
    });

    test("supports response.redirect().back() and redirect().back()", async () => {
        Route.get("/back-test", async (req: any, res: any) => {
            return res.redirect().back("/fallback");
        });

        const res = await router.getEngine().inject({
            method: "GET",
            url: "/back-test",
            headers: { referer: "/previous-page" }
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/previous-page");

        const resFallback = await router.getEngine().inject({
            method: "GET",
            url: "/back-test"
        });

        expect(resFallback.statusCode).toBe(302);
        expect(resFallback.headers.location).toBe("/fallback");
    });

    test("supports req.old() and global old() helper for reading flashed input", async () => {
        const { old, StartSession, config } = await import("../src/index.js");
        config({ "session.driver": "memory" });

        Route.group({ middlewares: [StartSession as any] }, () => {
            Route.post("/submit", async (req: any, res: any) => {
                return res.redirect().route("form").withInput();
            });

            Route.get("/form", async (req: any) => {
                return {
                    reqOldEmail: req.old("email"),
                    globalOldEmail: old("email"),
                    allOld: old()
                };
            }).name("form");
        });

        const setCookie = (await router.getEngine().inject({
            method: "POST",
            url: "/submit",
            headers: { "content-type": "application/json" },
            payload: { email: "alex@example.com", username: "alexvux" }
        })).headers["set-cookie"];

        const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);

        const formRes = await router.getEngine().inject({
            method: "GET",
            url: "/form",
            headers: { cookie: cookieHeader }
        });

        expect(formRes.statusCode).toBe(200);
        const data = JSON.parse(formRes.payload);
        expect(data.reqOldEmail).toBe("alex@example.com");
        expect(data.globalOldEmail).toBe("alex@example.com");
        expect(data.allOld).toEqual({ email: "alex@example.com", username: "alexvux" });
    });

    test("supports tuple [ControllerClass, 'method'] and chained .middleware(MiddlewareClass)", async () => {
        let middlewareRan = false;

        class SampleController {
            public show(req: any) {
                return `Sample Controller Show (middlewareRan=${req.raw.middlewareRan})`;
            }
        }

        class CustomMiddleware {
            public handle(req: any, res: any) {
                middlewareRan = true;
                req.raw.middlewareRan = true;
            }
        }

        container.bind(SampleController, () => new SampleController());
        container.bind(CustomMiddleware, () => new CustomMiddleware());

        Route.get("/tuple-route", [SampleController, "show"]).middleware(CustomMiddleware).name("tuple.route");

        const res = await router.getEngine().inject({
            method: "GET",
            url: "/tuple-route"
        });

        expect(res.statusCode).toBe(200);
        expect(middlewareRan).toBe(true);
        expect(res.payload).toBe("Sample Controller Show (middlewareRan=true)");
    });

    test("supports excluding auto-loaded middlewares via .withoutMiddleware()", async () => {
        const { VerifyCsrfToken, StartSession } = await import("../src/index.js");

        Route.group({ middlewares: [StartSession as any, VerifyCsrfToken as any] }, () => {
            Route.post("/web-with-csrf", async () => "CSRF protected");

            Route.post("/web-without-csrf", async () => "CSRF excluded")
                .withoutMiddleware(VerifyCsrfToken);

            Route.post("/web-without-alias", async () => "CSRF excluded by string")
                .withoutMiddleware("csrf");
        });

        // 1. Request to CSRF protected route without token should fail with 403
        const resCsrf = await router.getEngine().inject({
            method: "POST",
            url: "/web-with-csrf"
        });
        expect(resCsrf.statusCode).toBe(419);

        // 2. Request to withoutMiddleware(VerifyCsrfToken) should succeed with 200
        const resNoCsrf = await router.getEngine().inject({
            method: "POST",
            url: "/web-without-csrf"
        });
        expect(resNoCsrf.statusCode).toBe(200);
        expect(resNoCsrf.payload).toBe("CSRF excluded");

        // 3. Request to withoutMiddleware('csrf') should succeed with 200
        const resNoCsrfAlias = await router.getEngine().inject({
            method: "POST",
            url: "/web-without-alias"
        });
        expect(resNoCsrfAlias.statusCode).toBe(200);
        expect(resNoCsrfAlias.payload).toBe("CSRF excluded by string");
    });

    test("supports Route.middleware([MiddlewareClass]).group() syntax", async () => {
        let middlewareRan = false;

        class CustomGroupMw {
            public handle(req: any) {
                middlewareRan = true;
            }
        }

        container.bind(CustomGroupMw, () => new CustomGroupMw());

        Route.middleware([CustomGroupMw]).group(() => {
            Route.get("/group-mw-test", async () => "Group MW Ok");
        });

        const res = await router.getEngine().inject({
            method: "GET",
            url: "/group-mw-test"
        });

        expect(res.statusCode).toBe(200);
        expect(middlewareRan).toBe(true);
        expect(res.payload).toBe("Group MW Ok");
    });

    test("redirects back to referer on validation failure for web routes", async () => {
        const { FormRequest, StartSession } = await import("../src/index.js");

        class TestWebFormRequest extends FormRequest {
            public rules() {
                return { name: "required|min:3" };
            }
        }

        container.bind(TestWebFormRequest, () => new TestWebFormRequest());

        class TestController {
            public async store(formRequest: TestWebFormRequest) {
                return "Form Saved";
            }
        }

        container.bind(TestController, () => new TestController());

        Route.middleware([StartSession as any]).group(() => {
            Route.post("/web-form-submit", [TestController, "store"]);
        });

        // 1. Submit with invalid data on Web route (Accept: text/html)
        const res = await router.getEngine().inject({
            method: "POST",
            url: "/web-form-submit",
            headers: {
                accept: "text/html,application/xhtml+xml",
                referer: "http://localhost/contact"
            },
            payload: { name: "a" }
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost/contact");

        // 2. Submit with invalid data on API route (Accept: application/json)
        const resApi = await router.getEngine().inject({
            method: "POST",
            url: "/web-form-submit",
            headers: {
                accept: "application/json"
            },
            payload: { name: "a" }
        });

        expect(resApi.statusCode).toBe(422);
        expect(JSON.parse(resApi.payload).errors.name).toBeDefined();
    });
});
