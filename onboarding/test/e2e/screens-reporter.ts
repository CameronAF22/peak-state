// Playwright reporter: after the html reporter has written test/e2e/report/, copy the checkpoint
// screenshots staged by harness.spec.ts into test/e2e/report/screens/ and write a contact sheet
// (test/e2e/report/screens/index.html) that shows every checkpoint for both states in a grid.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FullResult, Reporter } from "@playwright/test/reporter";

const HERE = import.meta.dirname;
export const STAGING_DIR = resolve(HERE, "results/screens");
export const SCREENS_DIR = resolve(HERE, "report/screens");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function writeContactSheet(dir: string, status = ""): void {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
  const byState = new Map<string, string[]>();
  for (const f of files) {
    const state = f.split("-")[0];
    byState.set(state, [...(byState.get(state) ?? []), f]);
  }
  const sections = [...byState]
    .map(([state, list]) => {
      const cards = list
        .map((f) => {
          const caption = f.replace(/\.png$/, "").replace(/^[^-]+-/, "").replace(/-/g, " ");
          return `<figure><a href="${esc(f)}"><img src="${esc(f)}" alt="${esc(caption)}" loading="lazy"></a><figcaption>${esc(caption)}</figcaption></figure>`;
        })
        .join("\n");
      return `<h2>${esc(state)}</h2>\n<div class="grid">${cards}</div>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harness screens</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:22px}p{margin:0 0 16px;color:var(--muted)}h2{margin:28px 0 12px;text-transform:capitalize}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
img{display:block;width:100%;height:220px;object-fit:cover;object-position:top}
figcaption{padding:8px 10px;font-size:13px;color:var(--muted)}
</style></head><body>
<h1>Question harness: visual checkpoints</h1>
<p>${files.length} screenshots${status ? ` · run ${esc(status)}` : ""} · generated ${new Date().toISOString()}</p>
${sections || "<p>No screenshots were captured.</p>"}
</body></html>
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

export default class ScreensReporter implements Reporter {
  printsToStdio(): boolean {
    return false;
  }

  onEnd(result: FullResult): void {
    mkdirSync(SCREENS_DIR, { recursive: true });
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR)) {
        if (f.endsWith(".png")) copyFileSync(join(STAGING_DIR, f), join(SCREENS_DIR, f));
      }
    }
    writeContactSheet(SCREENS_DIR, result.status);
    console.log(`\n  Screens: ${join(SCREENS_DIR, "index.html")}`);
  }
}
