// Einrichtung in einem Rutsch: fragt nach Supabase-Zugang und Passwort, schreibt beide .env-Dateien
// und installiert die Abhängigkeiten von Dashboard und Worker.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node.js ${process.versions.node} ist zu alt. Bitte Node.js 22 von https://nodejs.org installieren.`);
  process.exit(1);
}

// Antworten können auch als Argumente übergeben werden, z. B. für Skripte:
//   node scripts/setup.mjs --url=https://x.supabase.co --key=... --password=... --email=... --no-install
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...rest] = a.slice(2).split("=");
    return [k, rest.length ? rest.join("=") : "true"];
  }),
);

const rl = createInterface({ input: stdin, output: stdout });
let finished = false;
rl.on("close", () => {
  if (!finished) {
    console.error("\nEingabe abgebrochen, es wurde nichts geschrieben.");
    process.exit(1);
  }
});
const ask = async (question, fallback = "", flag = "") => {
  if (flag && args[flag] !== undefined) return args[flag];
  const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  return answer || fallback;
};

console.log("\nSignal Arbitrage: Einrichtung\n");
console.log("Du brauchst ein Supabase-Projekt (kostenlos, https://supabase.com).");
console.log("Die beiden Werte findest du dort unter Project Settings → API.\n");

let url = "";
while (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  url = await ask("1/3  Project URL (sieht aus wie https://abcdefgh.supabase.co)", "", "url");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) console.log("     Das sieht nicht nach einer Supabase-URL aus, bitte noch einmal.");
}
url = url.replace(/\/$/, "");
let key = "";
while (key.length < 40) {
  key = await ask("2/3  service_role Key (langer Text, beginnt meist mit eyJ)", "", "key");
  if (key.length < 40) console.log("     Der Key ist zu kurz. Bitte den service_role Key kopieren, nicht den anon Key.");
}
const password = await ask("3/3  Passwort für das Dashboard", randomBytes(9).toString("base64url"), "password");
const alertEmail = await ask("Optional: deine E-Mail für Benachrichtigungen (Enter = keine)", "", "email");
finished = true;
rl.close();

const setEnv = (text, values) => {
  let out = text;
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    out = re.test(out) ? out.replace(re, `${k}=${v}`) : `${out}\n${k}=${v}`;
  }
  return out;
};
const backup = (file) => {
  if (existsSync(file)) {
    copyFileSync(file, `${file}.bak`);
    console.log(`Vorhandene ${file} als ${file}.bak gesichert.`);
  }
};

backup(".env.local");
writeFileSync(".env.local", [
  `SUPABASE_URL=${url}`,
  `SUPABASE_SERVICE_ROLE_KEY=${key}`,
  `DASHBOARD_USER=admin`,
  `DASHBOARD_PASSWORD=${password}`,
  ``,
].join("\n"));

backup("worker/.env");
writeFileSync("worker/.env", setEnv(readFileSync("worker/.env.example", "utf8"), {
  STORE: "supabase",
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: key,
  ADAPTERS: "ccxt,listings",
  MAILER: "console",
  ALERT_EMAIL: alertEmail,
  DASHBOARD_URL: "http://localhost:3000/arbitrage",
}));

console.log("\nDateien geschrieben: .env.local und worker/.env");
if (args["no-install"]) {
  console.log("Installation übersprungen (--no-install).");
} else {
  console.log("\nInstalliere Abhängigkeiten (dauert ein bis zwei Minuten) ...\n");
  execSync("npm install", { stdio: "inherit" });
  execSync("npm install", { stdio: "inherit", cwd: "worker" });
}

console.log(`
Fertig. So geht es weiter:

  1. Falls noch nicht geschehen: supabase/setup.sql im Supabase SQL-Editor einfügen und auf "Run" klicken.
  2. Starten mit:   npm run start:all
  3. Im Browser öffnen:  http://localhost:3000/arbitrage
     Benutzer: admin   Passwort: ${password}

Ohne Supabase und ohne Internet zum Ausprobieren:   npm run demo
`);
