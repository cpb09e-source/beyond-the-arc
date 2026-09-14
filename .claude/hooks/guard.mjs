/**
 * The PreToolUse hook entry: reads the tool call from stdin, answers with a deny
 * when a rule in ./guard-rules.mjs says so, and says nothing otherwise, so the
 * normal permission flow decides.
 *
 * FAILS OPEN. An error here exits 1, which Claude Code treats as a non-blocking
 * hook error: a bug in the guard never locks a session out of its own shell.
 */
import { decide } from "./guard-rules.mjs";

try {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  const verdict = decide(JSON.parse(data || "{}"));
  if (verdict) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason },
      }),
    );
  }
} catch (err) {
  process.stderr.write(`guard.mjs let this call through after an error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
