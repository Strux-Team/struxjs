// src/core/view/TemplateEngine.ts (Core engine)
import fs from "fs";
import path from "path";
import collect from "collect.js";
import { route } from "../http/Route.js";
import { auth } from "../auth/Auth.js";
import { csrf_token, old, session } from "../http/HttpContext.js";

export class TemplateEngine {
    private viewsDir: string;
    private static sharedData: Record<string, any> = {};

    public static share(key: string, value: any) {
        this.sharedData[key] = value;
    }

    constructor(customViewsDir?: string) {
        this.viewsDir = customViewsDir || path.join(process.cwd(), "resources", "views");
    }

    public render(viewPath: string, data: Record<string, any> = {}): string {
        let fullPath = viewPath;

        if (!path.isAbsolute(viewPath)) {
            const cleanPath = viewPath.replace(/\./g, path.sep);
            fullPath = path.join(this.viewsDir, `${cleanPath}.strux`);
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error(`[StruxJS View Error]: Template file not found at '${fullPath}'`);
        }

        let template = fs.readFileSync(fullPath, "utf8");

        // PHASE 1: PROCESS INCLUDES & SUBVIEWS
        template = this.processIncludes(template, data);

        // PHASE 2: PROCESS LAYOUT INHERITANCE (@extends, @section, @slot)
        template = this.processLayoutInheritance(template, data);

        // PHASE 3: EXTRACT @js AND @php CODE BLOCKS TO FUNCTION TOP LEVEL SCOPE
        const jsCodeBlocks: string[] = [];
        template = template.replace(/@(js|php)([\s\S]*?)@end\1/g, (_, __, code) => {
            jsCodeBlocks.push(code.trim());
            return "";
        });

        // PHASE 4: COMPILE DIRECTIVES
        template = this.compileDirectives(template);

        // PHASE 5: EXECUTE RUNTIME JAVASCRIPT FUNCTION
        try {
            const __escapeHtml = (val: any) => {
                if (val === undefined || val === null) return "";
                return String(val)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };

            const __toArray = (val: any) => {
                if (!val) return [];
                if (Array.isArray(val)) return val;
                if (typeof val.all === "function") return val.all();
                if (Array.isArray(val.data)) return val.data;
                if (typeof val[Symbol.iterator] === "function") return Array.from(val);
                return [];
            };
            const viewData = { ...TemplateEngine.sharedData, route, collect, auth, csrf_token, old, session, __escapeHtml, __toArray, ...data };
            const keys = Object.keys(viewData);
            const values = Object.values(viewData);
            const prepJsCode = jsCodeBlocks.length > 0 ? jsCodeBlocks.join("\n") + "\n" : "";
            const fnBody = `${prepJsCode}return \`${template}\`;`;
            const executor = new Function(...keys, fnBody);
            return executor(...values);
        } catch (error: any) {
            throw new Error(`[StruxJS View Compilation Error]: ${error.message}`);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Vite Asset Resolution                                               */
    /* ------------------------------------------------------------------ */

    /**
     * Resolve one or more asset paths to HTML <script>/<link> tags.
     *
     * Dev mode  (public/build/.vite/manifest.json absent):
     *   → injects Vite HMR client + dev server URLs (http://localhost:5173/...)
     *
     * Production (manifest exists):
     *   → reads manifest.json and outputs hashed asset URLs from public/build/
     *
     * @param entrypoints  e.g. ["resources/css/app.css", "resources/js/app.js"]
     */
    private resolveViteAssets(entrypoints: string[]): string {
        const publicBuild = path.join(process.cwd(), "public", "build");
        const manifestPath = path.join(publicBuild, ".vite", "manifest.json");
        const hasManifest  = fs.existsSync(manifestPath);

        // Dev mode: VITE_DEV=true (set automatically by vite dev server via .env or manually)
        // Production: manifest exists regardless of VITE_DEV
        const isDevMode = !hasManifest && process.env.VITE_DEV === "true";

        if (isDevMode) {
            const vitePort = process.env.VITE_PORT || "5173";
            const viteHost = `http://localhost:${vitePort}`;

            const tags: string[] = [
                `<script type="module" src="${viteHost}/@vite/client"></script>`
            ];

            for (const entry of entrypoints) {
                tags.push(`<script type="module" src="${viteHost}/${entry}"></script>`);
            }

            return tags.join("\n    ");
        }

        // No manifest, no dev mode — nothing to inject (Vite not running, not built yet)
        if (!hasManifest) {
            return `<!-- [StruxJS Vite] Run "npm run dev:assets" for dev or "npm run build:assets" for production -->`;
        }

        // Production: parse manifest and emit hashed URLs
        let manifest: Record<string, any>;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch {
            return `<!-- [StruxJS Vite] Could not read manifest at ${manifestPath} -->`;
        }

        const tags: string[] = [];
        const emittedCss = new Set<string>();

        for (const entry of entrypoints) {
            const chunk = manifest[entry];
            if (!chunk) {
                tags.push(`<!-- [StruxJS Vite] Entry "${entry}" not found in manifest -->`);
                continue;
            }

            // CSS linked to this JS chunk
            if (chunk.css) {
                for (const cssFile of chunk.css) {
                    if (!emittedCss.has(cssFile)) {
                        emittedCss.add(cssFile);
                        tags.push(`<link rel="stylesheet" href="/build/${cssFile}">`);
                    }
                }
            }

            // Main file
            if (chunk.file) {
                if (entry.endsWith(".css")) {
                    if (!emittedCss.has(chunk.file)) {
                        emittedCss.add(chunk.file);
                        tags.push(`<link rel="stylesheet" href="/build/${chunk.file}">`);
                    }
                } else {
                    tags.push(`<script type="module" src="/build/${chunk.file}"></script>`);
                }
            }

            // Preload module imports
            if (chunk.imports) {
                for (const imp of chunk.imports) {
                    const impChunk = manifest[imp];
                    if (impChunk?.file) {
                        tags.push(`<link rel="modulepreload" href="/build/${impChunk.file}">`);
                    }
                }
            }
        }

        return tags.join("\n    ");
    }

    /**
     * Recursively resolve @include and @includeIf directives
     */
    private processIncludes(template: string, data: Record<string, any>): string {
        // @include('view.name')
        template = template.replace(/@include\s*\(\s*['"](.*?)['"]\s*\)/g, (_, viewName) => {
            try {
                return this.render(viewName, data);
            } catch (e: any) {
                return `<!-- Include Error: ${e.message} -->`;
            }
        });

        // @includeIf('view.name')
        template = template.replace(/@includeIf\s*\(\s*['"](.*?)['"]\s*\)/g, (_, viewName) => {
            const cleanPath = viewName.replace(/\./g, path.sep);
            const targetPath = path.join(this.viewsDir, `${cleanPath}.strux`);
            if (fs.existsSync(targetPath)) {
                return this.render(viewName, data);
            }
            return "";
        });

        return template;
    }

    /**
     * Handle layout inheritance: @extends, @section, @slot
     */
    private processLayoutInheritance(template: string, data: Record<string, any>): string {
        const extendsMatch = template.match(/@extends\s*\(\s*['"](.*?)['"]\s*\)/);

        if (!extendsMatch) return template;

        const layoutName = extendsMatch[1].replace(/\./g, path.sep);
        const layoutPath = path.join(this.viewsDir, `${layoutName}.strux`);

        if (!fs.existsSync(layoutPath)) {
            throw new Error(`[StruxJS View Error]: Layout file not found at '${layoutPath}'`);
        }

        let layoutContent = fs.readFileSync(layoutPath, "utf8");

        // Extract all @section blocks from child View
        const sectionRegex = /@section\s*\(\s*['"](.*?)['"]\s*\)([\s\S]*?)@endsection/g;
        let match;
        const sections: Record<string, string> = {};

        while ((match = sectionRegex.exec(template)) !== null) {
            const sectionName = match[1];
            const sectionContent = match[2];
            sections[sectionName] = sectionContent;
        }

        // Inject section content into corresponding @slot directives in Layout
        layoutContent = layoutContent.replace(/@slot\s*\(\s*['"](.*?)['"]\s*\)/g, (_, slotName) => {
            return sections[slotName] !== undefined ? sections[slotName] : "";
        });

        return layoutContent;
    }

    /**
     * Compile all standard Blade directives to JS Template Literals
     */
    private compileDirectives(template: string): string {
        // 0. @vite() directive — resolve assets via Vite manifest or dev server
        // @vite('resources/css/app.css', 'resources/js/app.js')
        template = template.replace(/@vite\s*\((.*?)\)/g, (_, args) => {
            // Parse comma-separated quoted strings
            const entries = [...args.matchAll(/['"](.*?)['"]/g)].map((m: RegExpMatchArray) => m[1]);
            return this.resolveViteAssets(entries);
        });

        // 1. Remove comments {{-- comment --}}
        template = template.replace(/\{\{\-\-[\s\S]*?\-\-\}\}/g, "");

        // 2. Protect @verbatim ... @endverbatim
        const verbatimBlocks: string[] = [];
        template = template.replace(/@verbatim([\s\S]*?)@endverbatim/g, (_, body) => {
            const token = `__VERBATIM_PLACEHOLDER_${verbatimBlocks.length}__`;
            verbatimBlocks.push(body);
            return token;
        });

        // 3. Form Directives: @method('PUT')
        template = template.replace(/@method\s*\(\s*['"](.*?)['"]\s*\)/g, (_, m) => `<input type="hidden" name="_method" value="${m}">`);

        // Validation Error Directive: @error('field') ... @enderror
        template = template.replace(/@error\s*\(\s*['"](.*?)['"]\s*\)([\s\S]*?)@enderror/g, (_, field, content) => {
            return `\${ (typeof errors !== 'undefined' && errors.has('${field}')) ? (() => { const message = errors.first('${field}'); return \`${content}\`; })() : '' }`;
        });

        // 4. HTML Attribute Helpers: @checked, @selected, @disabled, @readonly, @required
        template = template.replace(/@checked\s*\((.*?)\)/g, (_, cond) => `\${ (${cond}) ? 'checked' : '' }`);
        template = template.replace(/@selected\s*\((.*?)\)/g, (_, cond) => `\${ (${cond}) ? 'selected' : '' }`);
        template = template.replace(/@disabled\s*\((.*?)\)/g, (_, cond) => `\${ (${cond}) ? 'disabled' : '' }`);
        template = template.replace(/@readonly\s*\((.*?)\)/g, (_, cond) => `\${ (${cond}) ? 'readonly' : '' }`);
        template = template.replace(/@required\s*\((.*?)\)/g, (_, cond) => `\${ (${cond}) ? 'required' : '' }`);

        // 6. CSRF Directive: @csrf -> <input type="hidden" name="_token" value="token">
        template = template.replace(/@csrf\b/g, () => {
            return '<input type="hidden" name="_token" value="${typeof csrf_token !== \'undefined\' ? csrf_token : (typeof _token !== \'undefined\' ? _token : \'\')}">';
        });

        // 7. JSON directive: @json(variable)
        template = template.replace(/@json\s*\((.*?)\)/g, (_, match) => `\${JSON.stringify(${match})}`);

        // 7. Unescaped Output: {!! rawHtml !!}
        template = template.replace(/\{\!\!\s*(.*?)\s*\!\!\}/g, (_, match) => {
            return `\${typeof ${match} !== 'undefined' ? ${match} : ''}`;
        });

        // 8. Escaped Output: {{ variable }} (XSS safe)
        template = template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, match) => {
            return `\${__escapeHtml(${match})}`;
        });

        // 9. Auth & Guest: @auth ... @endauth, @guest ... @endguest
        template = template.replace(/@auth\b/g, `\${ (typeof user !== 'undefined' && user) ? \``);
        template = template.replace(/@endauth\b/g, `\` : \`\` }`);
        template = template.replace(/@guest\b/g, `\${ (typeof user === 'undefined' || !user) ? \``);
        template = template.replace(/@endguest\b/g, `\` : \`\` }`);

        // 9b. Role & Can Directives: @role('admin') ... @endrole, @can('ability') ... @endcan
        template = template.replace(/@role\s*\(\s*['"](.*?)['"]\s*\)([\s\S]*?)@endrole/g, (_, role, body) => {
            return `\${ (typeof user !== 'undefined' && user && (user.role === '${role}' || (Array.isArray(user.roles) && user.roles.includes('${role}')))) ? \`${body}\` : '' }`;
        });
        template = template.replace(/@can\s*\(\s*['"](.*?)['"]\s*\)([\s\S]*?)@endcan/g, (_, ability, body) => {
            return `\${ (typeof user !== 'undefined' && user && (user.role === 'admin' || user.role === 'superadmin' || (Array.isArray(user.permissions) && user.permissions.includes('${ability}')) || (Array.isArray(user.roles) && (user.roles.includes('admin') || user.roles.includes('superadmin') || user.roles.includes('${ability}'))))) ? \`${body}\` : '' }`;
        });

        // 10. Unless: @unless (cond) ... @endunless
        template = this.replaceDirectiveWithParens(template, "unless", (_, cond) => `\${ !(${cond}) ? \``);
        template = template.replace(/@endunless\b/g, `\` : \`\` }`);

        // 11. Isset & Empty: @isset(var) ... @endisset, @empty(var) ... @endempty
        template = this.replaceDirectiveWithParens(template, "isset", (_, v) => `\${ (typeof ${v} !== 'undefined' && ${v} !== null) ? \``);
        template = template.replace(/@endisset\b/g, `\` : \`\` }`);

        template = this.replaceDirectiveWithParens(template, "empty", (_, v) => `\${ (!${v} || (Array.isArray(${v}) && ${v}.length === 0) || (typeof ${v} === 'object' && Object.keys(${v}).length === 0)) ? \``);
        template = template.replace(/@endempty\b/g, `\` : \`\` }`);

        // 12. Conditionals: @if (cond), @elseif (cond), @else, @endif
        template = this.replaceDirectiveWithParens(template, "if", (_, condition) => `\${ (() => { if (${condition}) { return \``);
        template = this.replaceDirectiveWithParens(template, "elseif", (_, condition) => `\`; } else if (${condition}) { return \``);
        template = template.replace(/@else\b/g, `\`; } else { return \``);
        template = template.replace(/@endif\b/g, `\`; } return ''; })() }`);

        // 13. Forelse Loop: @forelse (array as item) ... @empty ... @endforelse
        template = template.replace(/@forelse\s*\(\s*(.*?)\s+as\s+(.*?)\s*\)([\s\S]*?)@empty([\s\S]*?)@endforelse/g, (_, array, item, loopBody, emptyBody) => {
            return `\${ (() => { const __arr = __toArray(${array}); return (__arr && __arr.length > 0) ? __arr.map((${item}, index) => { const loop = { index, iteration: index + 1, first: index === 0, last: index === __arr.length - 1, count: __arr.length, even: index % 2 === 0, odd: index % 2 !== 0 }; return \`${loopBody}\`; }).join('') : \`${emptyBody}\`; })() }`;
        });

        // 14. Foreach Loop: @foreach (array as item) ... @endforeach
        template = template.replace(/@foreach\s*\(\s*(.*?)\s+as\s+(.*?)\s*\)([\s\S]*?)@endforeach/g, (_, array, item, loopBody) => {
            return `\${ (() => { const __arr = __toArray(${array}); return (__arr && __arr.length > 0) ? __arr.map((${item}, index) => { const loop = { index, iteration: index + 1, first: index === 0, last: index === __arr.length - 1, count: __arr.length, even: index % 2 === 0, odd: index % 2 !== 0 }; return \`${loopBody}\`; }).join('') : ''; })() }`;
        });

        // Restore verbatim blocks
        verbatimBlocks.forEach((body, index) => {
            template = template.replace(`__VERBATIM_PLACEHOLDER_${index}__`, body);
        });

        return template;
    }

    /**
     * Helper to reliably match directive calls with parenthesized argument list, handling nested parens and strings.
     */
    private replaceDirectiveWithParens(
        template: string,
        directive: string,
        replacer: (match: string, arg: string) => string
    ): string {
        const regex = new RegExp(`@${directive}\\s*\\(`, "g");
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        let result = "";

        while ((match = regex.exec(template)) !== null) {
            const start = match.index;
            const openParenIndex = match.index + match[0].length - 1;
            let depth = 1;
            let endParenIndex = -1;
            let inString: string | null = null;

            for (let i = openParenIndex + 1; i < template.length; i++) {
                const char = template[i];
                if (inString) {
                    if (char === inString && template[i - 1] !== "\\") {
                        inString = null;
                    }
                } else if (char === "'" || char === '"') {
                    inString = char;
                } else if (char === "(") {
                    depth++;
                } else if (char === ")") {
                    depth--;
                    if (depth === 0) {
                        endParenIndex = i;
                        break;
                    }
                }
            }

            if (endParenIndex !== -1) {
                result += template.slice(lastIndex, start);
                const arg = template.slice(openParenIndex + 1, endParenIndex).trim();
                const fullMatch = template.slice(start, endParenIndex + 1);
                result += replacer(fullMatch, arg);
                lastIndex = endParenIndex + 1;
                regex.lastIndex = lastIndex;
            }
        }
        result += template.slice(lastIndex);
        return result;
    }
}
