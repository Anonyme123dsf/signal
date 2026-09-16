// Startet Dashboard und Worker zusammen in einem Terminal. Strg+C beendet beide.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

for (const [file, hint] of [[".env.local", "npm run setup"], ["worker/.env", "npm run setup"]]) {
  if (!existsSync(file)) {
    console.error(`${file} fehlt. Bitte zuerst ausführen:  ${hint}`);
    process.exit(1);
  }
}

const jobs = [
  { name: "dashboard", color: "\x1b[36m", cwd: ".", cmd: "npm run dev" },
  { name: "worker", color: "\x1b[33m", cwd: "worker", cmd: "npm run dev" },
];
const reset = "\x1b[0m";
const children = [];

const prefix = (job, chunk, isErr) => {
  const out = isErr ? process.stderr : process.stdout;
  for (const line of chunk.toString().split(/\r?\n/)) if (line) out.write(`${job.color}[${job.name}]${reset} ${line}\n`);
};

for (const job of jobs) {
  const child = spawn(job.cmd, { cwd: job.cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  child.stdout.on("data", (c) => prefix(job, c, false));
  child.stderr.on("data", (c) => prefix(job, c, true));
  child.on("exit", (code) => {
    console.log(`${job.color}[${job.name}]${reset} beendet (Code ${code ?? "?"})`);
    stopAll(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGINT");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log("Dashboard: http://localhost:3000/arbitrage   (Strg+C beendet beide Prozesse)\n");
