import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /**
     * NETLIFY'S OWN BUILD OUTPUT, and the reason this list had to be restated.
     *
     * `netlify dev` bundles each function into .netlify/functions-serve/ —
     * esbuild output with every dependency inlined, including the whole AWS
     * SDK and Stripe's client. Linting it produced 24,048 warnings and 352
     * errors against code nobody here wrote and nobody can edit, which buried
     * the 19 real findings in src/ under a 24,000-line report. A report that
     * long is not read, so in practice the linter had stopped working.
     */
    ".netlify/**",
    // Playwright MCP scratch: page snapshots and console logs from a browser
    // check, written into the repo root and gitignored.
    ".playwright-mcp/**",
  ]),
  {
    rules: {
      /**
       * A LEADING UNDERSCORE MEANS "DELIBERATELY UNUSED".
       *
       * Without this, the convention half the codebase already follows —
       * `_ratingGames`, `_hideUntil`, `_` for a discarded destructure — was
       * being reported anyway, which taught everyone to ignore the rule rather
       * than to use the convention. Now the underscore is the way to say "this
       * is on purpose", and everything left in the report is genuinely dead.
       *
       * `caughtErrors: "all"` keeps `catch (e) {}` honest: an error you never
       * read is either `catch {}` or `catch (_e)`, and both say so out loud.
       */
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        caughtErrors: "all",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
