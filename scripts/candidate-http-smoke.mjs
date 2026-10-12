/** Same-process HTTP startup check; this is explicitly NOT browser verification. */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const output = process.argv[2] ?? "evidence/round2/http-smoke.json";
const built = process.argv.includes("--built");
const port = built ? 8081 : 8080;
mkdirSync(resolve(output, ".."), { recursive: true });
const child = spawn(
  "npm",
  built ? ["run", "preview", "--", "--host", "0.0.0.0", "--port", String(port)] : ["run", "dev"],
  {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: "",
      NODE_OPTIONS: `--require=${resolve("scripts/runtime-network-fallback.cjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
child.stdout.on("data", (x) => {
  log += x;
});
child.stderr.on("data", (x) => {
  log += x;
});
const ready = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(Error("STARTUP_TIMEOUT")), 20000);
  child.stdout.on("data", () => {
    if (log.includes("Local:") || log.includes("Listening on")) {
      clearTimeout(timer);
      res();
    }
  });
  child.on("error", rej);
  child.on("exit", (code) => {
    clearTimeout(timer);
    rej(Error("DEV_EXIT_" + code));
  });
});
let result;
try {
  await ready;
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(25000) });
  const html = await response.text();
  result = {
    scope: "SAME_PROCESS_HTTP_NOT_BROWSER",
    mode: built ? "BUILT_OUTPUT" : "DEV",
    status: response.status === 200 && html.includes("跑步力量") ? "PASS" : "FAIL",
    httpStatus: response.status,
    htmlBytes: Buffer.byteLength(html),
    brandPresent: html.includes("跑步力量"),
    personalDataUsed: false,
    databaseUrlDisabled: true,
  };
  if (!built) {
    const auth = spawnSync("npm", ["run", "check:auth"], { encoding: "utf8", timeout: 10000 });
    result.authInvariantExit = auth.status;
    writeFileSync(
      resolve(output, "..", "auth-invariant-final.log"),
      (auth.stdout ?? "") + (auth.stderr ?? ""),
    );
    if (auth.status !== 0) result.status = "FAIL";
  }
} catch (error) {
  result = {
    scope: "SAME_PROCESS_HTTP_NOT_BROWSER",
    status: "BLOCKED",
    error: String(error),
    personalDataUsed: false,
    databaseUrlDisabled: true,
  };
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
writeFileSync(output.replace(/\.json$/, ".server.log"), log);
console.log(JSON.stringify(result));
process.exitCode = result.status === "PASS" ? 0 : 1;
