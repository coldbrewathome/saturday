#!/usr/bin/env node
import { spawn } from "node:child_process";
import { concepts, here } from "./data.mjs";

const appUrlArg = process.argv.find((arg) => arg.startsWith("--app-url="));
const appUrl = appUrlArg || "--app-url=http://127.0.0.1:5173";
const skipCapture = process.argv.includes("--skip-capture");

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: here,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`node ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

if (!skipCapture) {
  await runNode(["capture-app.mjs", appUrl]);
}

await Promise.all(
  concepts().map((concept) => runNode(["render-one.mjs", concept.id])),
);

console.log("rendered promo previews:");
for (const concept of concepts()) {
  console.log(`  ${concept.file}`);
}

