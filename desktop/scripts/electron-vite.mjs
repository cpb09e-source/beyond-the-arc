#!/usr/bin/env node
/**
 * Run electron-vite with ELECTRON_RUN_AS_NODE removed from the environment.
 *
 * WHY THIS WRAPPER EXISTS. VS Code runs on Electron, and it exports
 * ELECTRON_RUN_AS_NODE=1 into its integrated terminal and everything its
 * extensions launch. Electron honours that variable in every child process: the
 * app starts as plain Node, `require("electron")` returns a file path instead of
 * the API, and the first line of the main process dies with
 * "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')".
 * Nothing in that message points at an environment variable.
 *
 * Deleting it here, for this process tree only, means `npm run dev` works the
 * same from VS Code's terminal as from any other.
 */
import { spawn } from "node:child_process";

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn("npx", ["electron-vite", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  // npx is a .cmd shim on Windows, which spawn cannot start without a shell.
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
