/**
 * StruxJS App JavaScript Entry Point
 *
 * This file is compiled by Vite and output to public/build/
 * Import additional modules below.
 *
 * Usage in .strux views:
 *   @vite('resources/css/app.css', 'resources/js/app.js')
 */

// Import app CSS (Vite handles CSS extraction in production)
import "../css/app.css";

/**
 * Auto-submit forms with data-confirm attribute
 * Usage: <button data-confirm="Are you sure?">Delete</button>
 */
document.addEventListener("DOMContentLoaded", () => {
    // Confirm dialogs
    document.querySelectorAll("[data-confirm]").forEach(el => {
        el.addEventListener("click", e => {
            const msg = el.getAttribute("data-confirm") || "Are you sure?";
            if (!window.confirm(msg)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });

    // Auto-hide flash alerts after 4 seconds
    document.querySelectorAll(".alert[data-auto-hide]").forEach(el => {
        setTimeout(() => {
            el.style.transition = "opacity 0.5s ease";
            el.style.opacity = "0";
            setTimeout(() => el.remove(), 500);
        }, 4000);
    });

    // Method spoofing: add hidden _method field for PUT/PATCH/DELETE forms
    document.querySelectorAll("form[data-method]").forEach(form => {
        const method = form.getAttribute("data-method")?.toUpperCase();
        if (method && ["PUT", "PATCH", "DELETE"].includes(method)) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "_method";
            input.value = method;
            form.appendChild(input);
            form.setAttribute("method", "POST");
        }
    });
});
