# Hanzi Parts Studio (`hanzi-mnemonic-deck`)

**One Card, One Job**: An English-speaking learner enters **one Simplified Chinese character or compound word** (or clicks a 1-click sample chip) and gets **one stroke-coloured visual mnemonic flashcard**.

- **Deterministic Stroke & Component Grounding (`$0.00`, `0` Hallucinated Characters)**:
  - Character stroke paths and sub-character decompositions come from **Make Me a Hanzi** (`dictionary.txt` under LGPL v3+, `graphics.txt` under the Arphic Public License).
  - Multi-character compound word readings, glosses, and polyphone syllable alignments come from **CC-CEDICT** (CC BY-SA 4.0).
  - Honest **Chain Fit Check** stops before any LLM call (`$0.00`) when an item does not match the active decomposition method (for example, entering `妈` on `Compound Idea`) rather than inventing false etymology.
- **Three Seeded Linguistic Decomposition Chains**:
  1. **`Compound Word` (Default)**: `2–4` character words whose characters combine literal meanings (`猫头鹰` owl = cat + head + eagle; `电脑` computer = electricity + brain).
  2. **`Compound Idea`**: Ideographic characters whose components combine meaning (`休` rest = person + tree; `森` forest = three trees).
  3. **`Sound + Meaning`**: Pictophonetic characters pairing one `MEANING PART` with one `♪ SOUND PART · FOR PRONUNCIATION ONLY` (`妈` mother = woman + horse for sound `mā`).
- **Heterogeneous 4-Step Gemini Pipeline & Cost Guards**:
  - **Steps 1–3 (`Project A · $0 Free Tier`)**: `gemini-3.5-flash-lite` (`T=0.10`) -> `gemini-3-flash-preview` (`T=0.85`) -> `gemini-3.1-flash-lite` (`T=0.15` strict JSON).
  - **Step 4 (`Project B · $0.034/img Flash Tier`)**: `gemini-3.1-flash-lite-image` (`T=0.60`, cascading to `gemini-nano-banana-2.1` on `429`/`503`) rendering a `1:1` zero-text absurd component scene.
  - Built-in cost guards: stored showcase/deck cards (`0` API calls on view), **`Text Steps Only ($0 Preview)`** switch + **`Render Scene ($0.034)`** upgrade action, server-side **`DAILY_IMAGE_CAP=40`**, and automatic Free-Tier model cascades.

## Quick Start

1. Copy `.env.example` to `.env.local` and set your shared Database A Supabase credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) plus `GEMINI_API_KEY` and `GEMINI_PAID_API_KEY`.
2. Apply `supabase/week9_migration.sql` in the Supabase SQL Editor (idempotent; isolated under `app_scope = 'hanzi_mnemonic'` and `mix_weight = 0`).
3. Install and start:
   ```bash
   npm install
   npm run dev
   ```
4. Run lint, unit + PGlite database tests, and production build:
   ```bash
   npm run lint
   npm test
   npm run build
   ```

## Open-Source Data Licenses

See `./licenses/`:
- `licenses/COPYING` & `licenses/LGPL` — Make Me a Hanzi `dictionary.txt` (GNU LGPL v3+).
- `licenses/APL/` — Make Me a Hanzi `graphics.txt` (Arphic Public License).
- `licenses/CC-CEDICT-LICENSE.txt` — CC-CEDICT compound readings & glosses (CC BY-SA 4.0).
