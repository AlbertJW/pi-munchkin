// slugify: canonical wiki slugs per docs/naming.md. Lowercase, transliterate
// special characters, then reduce everything else to single hyphens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CHARMAP = JSON.parse(readFileSync(join(here, "..", "data", "charmap.json"), "utf8"));

export function slugify(name) {
  let out = "";
  for (const ch of String(name).toLowerCase()) {
    out += CHARMAP[ch] ?? ch;
  }
  return out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
