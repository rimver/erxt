import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "vercel_dist");
const wwwSource = path.join(projectRoot, "erpnext", "www");
const publicSource = path.join(projectRoot, "erpnext", "public");

const SKIP_DIR_NAMES = new Set(["__pycache__"]);
const DISALLOWED_EXTENSIONS = new Set([".py", ".pyc", ".scss", ".sass", ".ts", ".tsx"]);
const TEMPLATE_TOKENS = /[{][{#%]/;

async function pathExists(targetPath) {
        try {
                await fs.access(targetPath);
                return true;
        } catch (error) {
                return false;
        }
}

async function emptyOutputDirectory() {
        await fs.rm(outputDir, { recursive: true, force: true });
        await fs.mkdir(outputDir, { recursive: true });
}

function shouldSkipDirectory(name) {
        return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

function shouldCopyFile(name) {
        const ext = path.extname(name).toLowerCase();
        if (!ext) {
                return true;
        }
        return !DISALLOWED_EXTENSIONS.has(ext);
}

async function copyFileWithChecks(src, dest) {
        if (!(await shouldIncludeHtml(src))) {
                return false;
        }

        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
        return true;
}

async function shouldIncludeHtml(src) {
        if (!src.endsWith(".html")) {
                return true;
        }

        const contents = await fs.readFile(src, "utf-8");
        if (!TEMPLATE_TOKENS.test(contents)) {
                return true;
        }

        console.warn(`Skipping template file that requires server rendering: ${path.relative(projectRoot, src)}`);
        return false;
}

async function copyDirectory(src, dest) {
        if (!(await pathExists(src))) {
                return;
        }

        const entries = await fs.readdir(src, { withFileTypes: true });
        await fs.mkdir(dest, { recursive: true });

        for (const entry of entries) {
                if (shouldSkipDirectory(entry.name)) {
                        continue;
                }

                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                        await copyDirectory(srcPath, destPath);
                } else if (entry.isFile() && shouldCopyFile(entry.name)) {
                        await copyFileWithChecks(srcPath, destPath);
                }
        }
}

async function collectHtmlRoutes(baseDir, relativeDir = "") {
        const absoluteDir = path.join(baseDir, relativeDir);
        if (!(await pathExists(absoluteDir))) {
                return [];
        }

        const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
        const routes = [];

        for (const entry of entries) {
                        if (entry.isDirectory()) {
                                const nested = await collectHtmlRoutes(baseDir, path.join(relativeDir, entry.name));
                                routes.push(...nested);
                        } else if (entry.isFile() && entry.name.endsWith(".html")) {
                                const routePath = path.join(relativeDir, entry.name);
                                if (routePath === "index.html") {
                                        routes.push("/");
                                } else {
                                        routes.push("/" + routePath.replace(/\\/g, "/"));
                                }
                        }
        }

        return routes;
}

function renderIndexPage(routes) {
        const filteredRoutes = Array.from(new Set(routes)).filter((route) => route !== "/");
        const listItems = filteredRoutes
                .sort()
                .map((route) => `                <li><a href="${route}">${route}</a></li>`)
                .join("\n");

        return `<!DOCTYPE html>
<html lang="en">
        <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>ERPNext Static Export</title>
                <style>
                        body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem; line-height: 1.5; }
                        h1 { font-size: 1.75rem; margin-bottom: 1rem; }
                        p { max-width: 60ch; }
                        ul { list-style: none; padding-left: 0; }
                        li { margin: 0.35rem 0; }
                        a { color: #1a73e8; text-decoration: none; }
                        a:hover { text-decoration: underline; }
                        code { background: #f1f3f4; padding: 0.25rem 0.4rem; border-radius: 0.3rem; }
                </style>
        </head>
        <body>
                <h1>ERPNext Static Export</h1>
                <p>
                        This build contains static assets that can be deployed on Vercel. Pages relying on
                        server-side rendering are skipped automatically. To regenerate this build locally,
                        run <code>yarn vercel-build</code>.
                </p>
                <p>Available static routes:</p>
                <ul>
${listItems || "                        <li>No static HTML routes were exported.</li>"}
                </ul>
        </body>
</html>`;
}

async function ensureIndexPage() {
        const indexPath = path.join(outputDir, "index.html");
        if (await pathExists(indexPath)) {
                return;
        }

        const routes = await collectHtmlRoutes(outputDir);
        const html = renderIndexPage(routes);
        await fs.writeFile(indexPath, html, "utf-8");
}

async function build() {
        console.log("Preparing static build directory for Vercel deployment...");
        await emptyOutputDirectory();

        console.log("Copying public assets...");
        await copyDirectory(publicSource, path.join(outputDir, "assets"));

        console.log("Copying static website pages...");
        await copyDirectory(wwwSource, outputDir);

        console.log("Generating index page...");
        await ensureIndexPage();

        console.log(`Static build generated at ${outputDir}`);
}

build().catch((error) => {
        console.error("Failed to generate Vercel build:", error);
        process.exitCode = 1;
});
