// Fasst alle Migrationen zu supabase/setup.sql zusammen, damit man nur eine Datei in den SQL-Editor kopieren muss.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const parts = files.map((f) => `-- ===== ${f} =====\n${readFileSync(join(dir, f), "utf8").trim()}\n`);
const out = `-- Automatisch aus supabase/migrations erzeugt (npm run sql:bundle). Nicht von Hand bearbeiten.
-- Kompletten Inhalt im Supabase SQL-Editor einfügen und ausführen. Mehrfaches Ausführen ist unschädlich.

${parts.join("\n")}`;
writeFileSync("supabase/setup.sql", out);
console.log(`supabase/setup.sql aus ${files.length} Migrationen erzeugt`);
