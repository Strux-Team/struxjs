import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { TemplateEngine } from "../src/core/view/TemplateEngine.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Template Engine (.strux)", () => {
    let tmpDir: string;
    let engine: TemplateEngine;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-views-test-"));
        engine = new TemplateEngine(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("renders variables with escaping and unescaped HTML", () => {
        fs.writeFileSync(path.join(tmpDir, "simple.strux"), "Hello {{ name }}! Raw: {!! html !!}");

        const output = engine.render("simple", {
            name: "<script>alert('xss')</script>",
            html: "<b>Bold</b>",
        });

        expect(output).toBe("Hello &lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;! Raw: <b>Bold</b>");
    });

    test("evaluates @if @else @endif conditionals", () => {
        fs.writeFileSync(
            path.join(tmpDir, "cond.strux"),
            "@if(isLoggedIn) Welcome Back @else Please Login @endif"
        );

        expect(engine.render("cond", { isLoggedIn: true }).trim()).toBe("Welcome Back");
        expect(engine.render("cond", { isLoggedIn: false }).trim()).toBe("Please Login");
    });

    test("evaluates @if without @else and session helper call", () => {
        fs.writeFileSync(
            path.join(tmpDir, "flash.strux"),
            "@if (session('success')) <div class=\"alert\">{{ session('success') }}</div> @endif"
        );

        const sessionMock = (key: string) => key === "success" ? "Flash Message!" : null;
        expect(engine.render("flash", { session: sessionMock }).trim()).toBe("<div class=\"alert\">Flash Message!</div>");

        const sessionEmpty = (_key: string) => null;
        expect(engine.render("flash", { session: sessionEmpty }).trim()).toBe("");
    });

    test("renders @foreach loops", () => {
        fs.writeFileSync(
            path.join(tmpDir, "loop.strux"),
            "<ul>@foreach(items as item)<li>{{ item }}</li>@endforeach</ul>"
        );

        const output = engine.render("loop", { items: ["Apple", "Banana"] });
        expect(output).toBe("<ul><li>Apple</li><li>Banana</li></ul>");
    });

    test("supports directives like @csrf, @method, and @json, plus csrf_token() function", () => {
        fs.writeFileSync(
            path.join(tmpDir, "directives.strux"),
            "@csrf @method('DELETE') Data: @json(user) TokenFn: {{ csrf_token() }} TokenVal: {{ csrf_token }}"
        );

        const csrfTokenVal = "xyz123";
        const csrfTokenHelper: any = () => csrfTokenVal;
        csrfTokenHelper.toString = () => csrfTokenVal;

        const output = engine.render("directives", {
            csrf_token: csrfTokenHelper,
            user: { id: 1 },
        });

        expect(output).toContain('<input type="hidden" name="_token" value="xyz123">');
        expect(output).toContain('<input type="hidden" name="_method" value="DELETE">');
        expect(output).toContain('Data: {"id":1}');
        expect(output).toContain('TokenFn: xyz123');
        expect(output).toContain('TokenVal: xyz123');
    });

    test("supports layout inheritance with @extends, @section, and @slot", () => {
        fs.writeFileSync(
            path.join(tmpDir, "app.strux"),
            "<html><head><title>@slot('title')</title></head><body>@slot('content')</body></html>"
        );

        fs.writeFileSync(
            path.join(tmpDir, "page.strux"),
            "@extends('app') @section('title')Home Page@endsection @section('content')<h1>Main Content</h1>@endsection"
        );

        const output = engine.render("page");
        expect(output).toContain("<title>Home Page</title>");
        expect(output).toContain("<body><h1>Main Content</h1></body>");
    });

    test("supports @js block variable declarations in template scope", () => {
        fs.writeFileSync(
            path.join(tmpDir, "jsblock.strux"),
            "@js\nconst a = 10;\nconst b = 20;\n@endjs\nResult: {{ a + b }}"
        );

        const output = engine.render("jsblock");
        expect(output.trim()).toBe("Result: 30");
    });
});
