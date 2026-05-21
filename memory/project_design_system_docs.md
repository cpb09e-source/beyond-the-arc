---
name: project-design-system-docs
description: "PRODUCT.md and DESIGN.md at repo root document the BTA design system — register, voice, anti-references, palette, typography, recurring patterns. Impeccable skill's load-context.mjs picks them up automatically."
metadata:
  node_type: memory
  type: project
---

Created 2026-05-21 to support Impeccable-skill design work. Living docs at repo root:

- **[PRODUCT.md](../PRODUCT.md)** — register (`product`, not brand), users (hoop sickos / CBB journalists / bettors / coaches-analysts), voice (editorial sports magazine), anti-references (ESPN / SaaS / KenPom 2003 / Crypto dark mode / Linear-saturated), strategic principles (methodology visible-not-hidden, density-is-a-feature, comparability-is-the-product, static-first, opinionated-solo-built).
- **[DESIGN.md](../DESIGN.md)** — color tokens (paper / coral / ink / good/bad chart pair), type stack (Fraunces display + Geist sans + Geist mono), spacing rhythm, the recurring **headline card pattern** (coral top rule → kicker → display headline → meta → table), motion (ease-out-expo, transform/opacity only), product bans (no side-stripes / gradient text / glassmorphism / SaaS hero-metric / em dashes).

**Why:** Impeccable's `polish` / `critique` / `craft` / `shape` commands require PRODUCT.md context or they produce generic output. Writing once means every future design conversation has anchored language for "what we are" and "what drift looks like."

**How to apply:**

- For any design / polish / critique / "make it look better" task, these are the ground truth. Cite specific principles when proposing changes (e.g. "this drifts toward the SaaS hero-metric ban in DESIGN.md").
- Impeccable's loader (`~/.agents/skills/impeccable/scripts/load-context.mjs`) finds them automatically from repo root.
- When the user wants a register change, voice shift, or new anti-reference, edit these files directly — they're the source of truth.
- Don't rewrite them from scratch in a new session. Read and extend.

Related: [[reference-design-tooling]]
