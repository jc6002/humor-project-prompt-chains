import type { SampleSceneId } from './types';

export type SampleSceneSpec = {
  id: SampleSceneId;
  shortBadge: string;
  title: string;
  defaultPremise: string;
  visualBlueprint: string;
  svgMarkup: string;
};

export const SAMPLE_SCENES: readonly SampleSceneSpec[] = [
  {
    id: 'scene-stack-trace',
    shortBadge: 'SCENE 01',
    title: '3 AM Stack Trace & 4 Espressos',
    defaultPremise:
      'Debugging the same one-line typo for four hours instead of reading the error message.',
    visualBlueprint:
      'Dark IDE window displaying "SyntaxError: missing ) on line 3" in crimson red while the cursor sits down at line 418; beside the monitor stand four empty stacked espresso cups and a glowing 03:14 desk clock.',
    svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <rect width="320" height="200" rx="12" fill="#141915"/>
  <rect x="14" y="16" width="204" height="142" rx="8" fill="#1d241e" stroke="#4a5846" stroke-width="1.5"/>
  <circle cx="28" cy="28" r="4" fill="#e06c60"/>
  <circle cx="40" cy="28" r="4" fill="#e5b567"/>
  <circle cx="52" cy="28" r="4" fill="#7fc97f"/>
  <text x="68" y="31" fill="#a8b4a2" font-family="monospace" font-size="9">app.ts — line 418</text>
  <rect x="24" y="42" width="184" height="24" rx="4" fill="#3a1c1a" stroke="#c85a4f" stroke-width="1"/>
  <text x="30" y="57" fill="#ffb4a8" font-family="monospace" font-size="8.5" font-weight="bold">SyntaxError: missing ) on line 3</text>
  <rect x="24" y="76" width="118" height="6" rx="3" fill="#374437"/>
  <rect x="24" y="90" width="154" height="6" rx="3" fill="#374437"/>
  <rect x="24" y="104" width="96" height="6" rx="3" fill="#4f6349"/>
  <rect x="24" y="118" width="166" height="6" rx="3" fill="#374437"/>
  <rect x="24" y="134" width="132" height="8" rx="3" fill="#cbfb6d" opacity="0.85"/>
  <rect x="232" y="20" width="74" height="34" rx="6" fill="#1f271f" stroke="#6c8841" stroke-width="1.5"/>
  <text x="269" y="42" text-anchor="middle" fill="#cbfb6d" font-family="monospace" font-size="16" font-weight="bold">03:14</text>
  <g transform="translate(242,68)">
    <rect x="6" y="66" width="38" height="20" rx="4" fill="#eceae2" stroke="#6c7567" stroke-width="1.5"/>
    <path d="M44 71 h7 a5 5 0 0 1 0 10 h-7" fill="none" stroke="#eceae2" stroke-width="2.5"/>
    <rect x="8" y="45" width="36" height="20" rx="4" fill="#dfe4d8" stroke="#6c7567" stroke-width="1.5"/>
    <path d="M44 50 h7 a5 5 0 0 1 0 10 h-7" fill="none" stroke="#dfe4d8" stroke-width="2.5"/>
    <rect x="5" y="24" width="36" height="20" rx="4" fill="#eceae2" stroke="#6c7567" stroke-width="1.5"/>
    <path d="M41 29 h7 a5 5 0 0 1 0 10 h-7" fill="none" stroke="#eceae2" stroke-width="2.5"/>
    <rect x="9" y="3" width="34" height="20" rx="4" fill="#f7f7f2" stroke="#6c7567" stroke-width="1.5"/>
    <path d="M43 8 h6 a5 5 0 0 1 0 10 h-6" fill="none" stroke="#f7f7f2" stroke-width="2.5"/>
  </g>
  <rect x="14" y="168" width="292" height="18" rx="4" fill="#202820"/>
  <text x="160" y="180" text-anchor="middle" fill="#cfd6c6" font-family="sans-serif" font-size="9.5">4 ESPRESSOS DEEP · STILL REFUSING TO READ LINE 3</text>
</svg>`,
  },
  {
    id: 'scene-burning-ci',
    shortBadge: 'SCENE 02',
    title: '100% CI Pass in Burning Server Room',
    defaultPremise:
      'Autonomous coding agent achieves 100% test pass rate by deleting the test folder.',
    visualBlueprint:
      'Smiling robot holding a bright green "BUILD PASSING 100%" banner in the foreground while server racks behind it erupt in orange flames and smoke alongside a terminal reading "rm -rf /tests".',
    svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <rect width="320" height="200" rx="12" fill="#171412"/>
  <rect x="18" y="34" width="84" height="126" rx="6" fill="#262220" stroke="#664538" stroke-width="1.5"/>
  <rect x="26" y="46" width="68" height="14" rx="3" fill="#382924"/>
  <circle cx="34" cy="53" r="3" fill="#ff6b4a"/>
  <circle cx="44" cy="53" r="3" fill="#ff6b4a"/>
  <rect x="26" y="68" width="68" height="14" rx="3" fill="#382924"/>
  <circle cx="34" cy="75" r="3" fill="#ffb347"/>
  <path d="M44 34 C38 14, 58 8, 60 26 C68 10, 86 16, 78 34 Z" fill="#ff7438"/>
  <path d="M52 34 C50 20, 64 16, 68 34 Z" fill="#ffd166"/>
  <rect x="206" y="44" width="96" height="62" rx="6" fill="#1e241d" stroke="#53664b" stroke-width="1.5"/>
  <text x="214" y="64" fill="#9fb09a" font-family="monospace" font-size="8.5">$ rm -rf /tests</text>
  <text x="214" y="80" fill="#cbfb6d" font-family="monospace" font-size="8.5">0 failed (0 run)</text>
  <text x="214" y="95" fill="#7fc97f" font-family="monospace" font-size="8.5">EXIT CODE: 0</text>
  <rect x="92" y="18" width="136" height="28" rx="6" fill="#1e5e32" stroke="#cbfb6d" stroke-width="2"/>
  <text x="160" y="36" text-anchor="middle" fill="#ffffff" font-family="monospace" font-size="11" font-weight="bold">BUILD PASSING 100%</text>
  <rect x="126" y="64" width="68" height="56" rx="12" fill="#dfe6da" stroke="#46523e" stroke-width="2"/>
  <circle cx="146" cy="86" r="5" fill="#141812"/>
  <circle cx="174" cy="86" r="5" fill="#141812"/>
  <path d="M144 103 Q160 115 176 103" fill="none" stroke="#165b2b" stroke-width="3" stroke-linecap="round"/>
  <rect x="116" y="124" width="88" height="36" rx="8" fill="#2b3529" stroke="#6c8841" stroke-width="1.5"/>
  <text x="160" y="146" text-anchor="middle" fill="#cbfb6d" font-family="monospace" font-size="9.5">AGENT-CI v4</text>
  <rect x="18" y="168" width="284" height="18" rx="4" fill="#26201d"/>
  <text x="160" y="180" text-anchor="middle" fill="#f3d5c8" font-family="sans-serif" font-size="9.5">ZERO FAILING TESTS WHEN ZERO TESTS REMAIN</text>
</svg>`,
  },
  {
    id: 'scene-cat-force-push',
    shortBadge: 'SCENE 03',
    title: 'Finals Week Cat on Keyboard',
    defaultPremise:
      'Group project repo force-pushed five minutes before the midnight submission deadline.',
    visualBlueprint:
      'Open laptop on a study desk at 11:55 PM surrounded by textbooks and sticky notes while a round orange tabby cat presses its front paw directly on the Enter key under "git push --force origin main".',
    svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <rect width="320" height="200" rx="12" fill="#161918"/>
  <rect x="20" y="20" width="64" height="36" rx="4" fill="#f6e27f" stroke="#b89f36" stroke-width="1"/>
  <text x="52" y="36" text-anchor="middle" fill="#1e1c14" font-family="sans-serif" font-size="8.5" font-weight="bold">DUE 11:59 PM</text>
  <text x="52" y="49" text-anchor="middle" fill="#7a2419" font-family="monospace" font-size="9" font-weight="bold">NOW 11:55</text>
  <rect x="96" y="18" width="186" height="84" rx="7" fill="#1e2620" stroke="#5b6d57" stroke-width="1.5"/>
  <text x="108" y="42" fill="#9fb09a" font-family="monospace" font-size="8.5">$ git status</text>
  <text x="108" y="58" fill="#ffb4a6" font-family="monospace" font-size="8.8" font-weight="bold">$ git push --force origin main</text>
  <rect x="108" y="70" width="154" height="18" rx="4" fill="#3a1c1a"/>
  <text x="114" y="82" fill="#ffd2c9" font-family="monospace" font-size="8">[ENTER] rewriting 47 commits...</text>
  <polygon points="74,106 292,106 306,156 60,156" fill="#2c332d" stroke="#5b6d57" stroke-width="1.5"/>
  <rect x="234" y="122" width="52" height="24" rx="4" fill="#c85a4f" stroke="#ffd2c9" stroke-width="1.5"/>
  <text x="260" y="138" text-anchor="middle" fill="#ffffff" font-family="monospace" font-size="8.5" font-weight="bold">ENTER</text>
  <ellipse cx="176" cy="116" rx="42" ry="25" fill="#e68a3e" stroke="#8a4b17" stroke-width="1.5"/>
  <circle cx="216" cy="94" r="19" fill="#ef9a4c" stroke="#8a4b17" stroke-width="1.5"/>
  <polygon points="202,80 208,65 217,77" fill="#ef9a4c" stroke="#8a4b17" stroke-width="1.5"/>
  <polygon points="220,77 230,65 234,81" fill="#ef9a4c" stroke="#8a4b17" stroke-width="1.5"/>
  <circle cx="210" cy="92" r="2.5" fill="#141812"/>
  <circle cx="224" cy="92" r="2.5" fill="#141812"/>
  <path d="M222 108 L244 123" stroke="#ef9a4c" stroke-width="9" stroke-linecap="round"/>
  <circle cx="245" cy="124" r="5.5" fill="#ffd9b3" stroke="#8a4b17" stroke-width="1.2"/>
  <rect x="18" y="168" width="284" height="18" rx="4" fill="#202620"/>
  <text x="160" y="180" text-anchor="middle" fill="#cfd6c6" font-family="sans-serif" font-size="9.5">PAW ON ENTER · 4 MINUTES BEFORE SUBMISSION DEADLINE</text>
</svg>`,
  },
  {
    id: 'scene-ai-toaster',
    shortBadge: 'SCENE 04',
    title: 'Series A Pitch for an AI Toaster',
    defaultPremise:
      'Pitching venture capitalists on a subscription LLM wrapper for a kitchen appliance.',
    visualBlueprint:
      'Founder in a black turtleneck pointing at a projector chart labeled "Neural Bread Cloud ($40M Seed)" with a hockey-stick arrow while a smart Wi-Fi toaster beside the podium shoots black smoke and burnt charcoal toast.',
    svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <rect width="320" height="200" rx="12" fill="#151814"/>
  <rect x="18" y="18" width="176" height="106" rx="8" fill="#f7f7f2" stroke="#8aa839" stroke-width="2"/>
  <text x="28" y="37" fill="#141812" font-family="sans-serif" font-size="10" font-weight="bold">NEURAL BREAD CLOUD</text>
  <text x="28" y="50" fill="#175c2c" font-family="monospace" font-size="8.5">$40M SEED · $29/MO PER SLICE</text>
  <polyline points="30,108 68,102 104,94 138,74 176,34" fill="none" stroke="#165b2b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="176" cy="34" r="4.5" fill="#165b2b"/>
  <circle cx="94" cy="112" r="13" fill="#e6c7a8" stroke="#30362d" stroke-width="1.5"/>
  <rect x="78" y="125" width="32" height="35" rx="6" fill="#141812" stroke="#46523e" stroke-width="1.5"/>
  <rect x="214" y="96" width="84" height="58" rx="10" fill="#cfd6c6" stroke="#46523e" stroke-width="2"/>
  <rect x="226" y="114" width="60" height="18" rx="4" fill="#181c15"/>
  <text x="256" y="126" text-anchor="middle" fill="#cbfb6d" font-family="monospace" font-size="7.5">WIFI 502</text>
  <rect x="228" y="72" width="22" height="24" rx="4" fill="#231f1e" stroke="#6b5c56" stroke-width="1.5"/>
  <rect x="260" y="68" width="22" height="28" rx="4" fill="#1d1918" stroke="#6b5c56" stroke-width="1.5"/>
  <path d="M238 66 C230 48, 248 40, 244 24" fill="none" stroke="#8d9689" stroke-width="3" stroke-linecap="round"/>
  <path d="M270 62 C262 44, 282 36, 276 20" fill="none" stroke="#8d9689" stroke-width="3" stroke-linecap="round"/>
  <rect x="18" y="168" width="284" height="18" rx="4" fill="#20261e"/>
  <text x="160" y="180" text-anchor="middle" fill="#cfd6c6" font-family="sans-serif" font-size="9.5">AGENTIC CRUMB TELEMETRY · TOAST STILL BURNT</text>
</svg>`,
  },
] as const;

export function getSampleSceneById(sceneId: string | null | undefined): SampleSceneSpec | null {
  if (!sceneId) return null;
  const clean = sceneId.trim().toLowerCase();
  if (clean === 'scene-toaster' || clean === 'scene-series-a-toaster') {
    return SAMPLE_SCENES[3];
  }
  return SAMPLE_SCENES.find((s) => s.id === clean) ?? null;
}

export function getSampleSceneDataUri(scene: SampleSceneSpec): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(scene.svgMarkup)}`;
}
