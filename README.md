# AI Joke Lab — Prompt Chain Studio (`humor-project-prompt-chains`)

Standalone Week 8 superadmin workbench for authoring, reordering, testing, and inspecting multi-step multimodal vision-to-humor prompt pipelines against the shared AI Joke Lab Supabase backend.

## Highlights

- **Superadmin Google OAuth Gate (`profiles.is_superadmin == TRUE`)**: Middleware cookie refresh, origin-hardened OAuth callbacks, self-service `403` SQL bootstrap panel for non-superadmin accounts, and server-side superadmin enforcement across every `/api/*` endpoint.
- **Prompt Chain & Pipeline Step Studio**: Full CRUD for `prompt_chains` and `prompt_chain_steps`, template variable insertion chips (`{{input}}`, `{{prev_output}}`, `{{step_1_output}}`, ...), and `23505`-proof atomic two-phase step reordering (`↑` / `↓` and custom `Move to #` listbox).
- **Live Sequential Multimodal Runner**: Runs ordered steps sequentially (`Step 1 -> Step 2 -> ... -> Step K`) across OpenAI (`openai_responses`, `openai_chat_completions`), Google Gemini (`gemini_generate_content`), and Anthropic (`anthropic_messages`) using built-in SVG sample scenes (client-rasterized to PNG), uploaded images (`PNG/JPEG/WebP/GIF`), or SSRF-guarded `https://` image URLs.
- **Chain-Filtered Generated Media Gallery**: Displays uncropped source visuals alongside the final 5 funny captions and an expandable step-by-step intermediate output waterfall with compiled prompts, token counts, and per-step latencies.
- **Zero-FOUC Light / Dark / System Theme**: Semantic CSS custom properties meeting WCAG AAA contrast (`>= 7:1`) in both Dark obsidian-lime and Light editorial forest-emerald palettes.

## Quick Start

1. Copy `.env.example` to `.env.local` and configure your AI Joke Lab Supabase credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and provider API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_MODEL=gpt-6-luna,gpt-5.6-luna`, `GEMINI_MODEL=gemini-3-flash-preview`, `GENERATION_ENABLED=true`).
2. Run `supabase/week8_migration.sql` once in your Supabase SQL Editor (idempotent additive migration).
3. Install dependencies and verify checks:

```bash
npm install
npx tsc --noEmit
npm run lint
npm test
npm run test:db
npm run build
npm run dev
```

Open `http://localhost:3002` and sign in with a Google account whose `public.profiles.is_superadmin` is `TRUE`.

## Deployment notes (2026-11-02)

Next.js and eslint-config-next updated to 16.4.4 following npm audit. Windows database-test entry detection corrected. For the existing AI Joke Lab Week 8 database, apply `supabase/week8_studio_addition.sql`: it preserves existing policies and arena data, adds the runs table / atomic reorder RPC / visual chain, and does not seed demonstration runs as real history.
