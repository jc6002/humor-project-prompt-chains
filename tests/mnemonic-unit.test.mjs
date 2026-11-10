import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { runMnemonicDbSuite } from './mnemonic-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

register('./ts-loader.mjs', pathToFileURL(`${repoRoot}/tests/`));

const { resolveSafeOrigin, resolveSafeNextPath } = await import(
  pathToFileURL(path.join(repoRoot, 'src/lib/supabase/origin.ts')).href
);
const { lookupHanziTarget, getHanziDataset, conciseGloss } = await import(
  pathToFileURL(path.join(repoRoot, 'src/lib/hanzi/dataset.ts')).href
);
const { HANZI_MODEL_CATALOG, HANZI_METHOD_TABS } = await import(
  pathToFileURL(path.join(repoRoot, 'src/lib/chains/presets.ts')).href
);
const {
  GEMINI_IMAGE_FALLBACK_CASCADE,
  GEMINI_TEXT_FALLBACK_CASCADE,
  buildImageStepHttpRequest,
  buildTextStepHttpRequest,
  extractTextStepOutput,
  resolveEffectiveStepCredential,
} = await import(pathToFileURL(path.join(repoRoot, 'src/lib/chains/step-protocols.ts')).href);
const {
  compileCardFromTextTraces,
  compileMnemonicStepInstruction,
  formatLiveTracePreview,
  normalizeModelId,
  normalizeStoredCard,
  truncateAtWordBoundary,
} = await import(pathToFileURL(path.join(repoRoot, 'src/lib/chains/validation.ts')).href);

test('Safe origin and redirect path guards block spoofed headers and external URLs', () => {
  const req = new Request('http://127.0.0.1:3005/auth/callback?code=abc', {
    headers: {
      host: 'evil.example.com',
      'x-forwarded-host': 'evil.example.com',
    },
  });
  assert.equal(resolveSafeOrigin(req, {}), 'http://127.0.0.1:3005');
  assert.equal(resolveSafeNextPath('//evil.com', 'http://127.0.0.1:3005'), '/');
  assert.equal(
    resolveSafeNextPath('/?chain=sound-meaning', 'http://127.0.0.1:3005'),
    '/?chain=sound-meaning'
  );
});

test('Make Me a Hanzi + CC-CEDICT lookup, Gap G22 2D IDS/null/incomplete guards, polyphones, and honest Fit Check', () => {
  const ds = getHanziDataset();
  assert.equal(ds.dict.size, 9574);
  assert.equal(ds.strokes.size, 9574);
  assert.ok(ds.compounds.size > 90000);

  // 1. Compound Word + polyphone syllable & reading-matched gloss alignment (长颈鹿 -> cháng = long)
  const giraffe = lookupHanziTarget('长颈鹿', 'compound_word');
  assert.equal(giraffe.status, 'fit');
  assert.equal(giraffe.pinyin, 'cháng jǐng lù');
  assert.equal(giraffe.parts[0].pinyin, 'cháng');
  assert.match(giraffe.parts[0].gloss, /long/i);
  assert.equal(giraffe.glyphs.length, 3);

  const music = lookupHanziTarget('音乐', 'compound_word');
  assert.equal(music.status, 'fit');
  assert.equal(music.pinyin, 'yīn yuè');
  assert.equal(music.parts[1].pinyin, 'yuè');

  // 2. Compound Idea recursive 2D IDS leaf paths on 森 ([0], [1,0], [1,1] -> 3 distinct coloured trees!)
  const sen = lookupHanziTarget('森', 'compound_idea');
  assert.equal(sen.status, 'fit');
  assert.equal(sen.parts.length, 3);
  const senUniqueIndices = new Set(sen.glyphs[0].strokePartIndex);
  assert.deepEqual([...senUniqueIndices].sort(), [1, 2, 3]);

  // 3. Sound + Meaning subtree prefix-path matching on 清 (⿰氵青 colours all 青 strokes uniformly as Part 2)
  const qing = lookupHanziTarget('清', 'sound_meaning');
  assert.equal(qing.status, 'fit');
  assert.equal(qing.parts[0].role, 'MEANING');
  assert.equal(qing.parts[1].role, 'SOUND_ONLY');
  assert.match(qing.parts[1].role_badge, /FOR PRONUNCIATION ONLY/);
  const qingIndices = new Set(qing.glyphs[0].strokePartIndex);
  assert.deepEqual([...qingIndices].sort(), [1, 2]);

  // 4. Honest Chain Fit Check: 妈 on Compound Idea stops at $0.00 and redirects to Sound + Meaning
  const maMismatch = lookupHanziTarget('妈', 'compound_idea');
  assert.equal(maMismatch.status, 'fit_mismatch');
  assert.equal(maMismatch.fitting_chain_slug, 'sound-meaning');
  assert.match(maMismatch.mismatch_reason ?? '', /sound component/i);

  // 5. Incomplete simplified pictophonetic (脑 lacks phonetic in Make Me a Hanzi) -> honest base_pictograph notice
  const nao = lookupHanziTarget('脑', 'sound_meaning');
  assert.equal(nao.status, 'base_pictograph');
  assert.ok(nao.suggested_samples.some((s) => s.hanzi === '电脑'));

  // 6. Base pictograph (木) -> honest foundational character notice with derivatives
  const muBase = lookupHanziTarget('木', 'compound_idea');
  assert.equal(muBase.status, 'base_pictograph');
  assert.ok(muBase.suggested_samples.some((s) => s.hanzi === '休'));

  // 7. Null stroke match safety across all 9,574 characters (never throws)
  let nullStrokeCharsVerified = 0;
  for (const [ch, entry] of ds.dict.entries()) {
    if (entry.matches?.some((m) => m === null)) {
      const res = lookupHanziTarget(ch, 'flexible');
      assert.equal(res.glyphs.length, 1);
      nullStrokeCharsVerified += 1;
    }
  }
  assert.ok(nullStrokeCharsVerified >= 400);
});

test('Locked 5-model catalog (0 high-cost Pro image), Dual-Key routing, zero-thinking flash-lite, and 1:1 image spec', () => {
  const proBanned = ['gemini', '3', 'pro', 'image'].join('-');
  assert.deepEqual(
    HANZI_MODEL_CATALOG.map((m) => m.modelId),
    [
      'gemini-3.5-flash-lite',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-image',
      'gemini-nano-banana-2.1',
    ]
  );
  assert.equal(HANZI_MODEL_CATALOG.some((m) => m.modelId === proBanned), false);
  assert.equal(GEMINI_IMAGE_FALLBACK_CASCADE.includes(proBanned), false);
  assert.equal(normalizeModelId(proBanned, 'image_generation'), 'gemini-3.1-flash-lite-image');
  assert.equal(normalizeModelId('gemini-2.5-flash', 'text'), 'gemini-3.5-flash-lite');
  assert.deepEqual(GEMINI_TEXT_FALLBACK_CASCADE, [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
  ]);

  const dualEnv = { GEMINI_API_KEY: 'free-key-a', GEMINI_PAID_API_KEY: 'paid-key-b' };
  assert.equal(
    resolveEffectiveStepCredential('gemini', 'gemini-3.5-flash-lite', 'text', dualEnv).apiKey,
    'free-key-a'
  );
  assert.equal(
    resolveEffectiveStepCredential('gemini', 'gemini-3.1-flash-lite-image', 'image_generation', dualEnv).apiKey,
    'paid-key-b'
  );

  // Flash-lite omits thinkingConfig; gemini-3-flash-preview sets thinkingBudget: 0
  const liteReq = JSON.parse(
    buildTextStepHttpRequest({
      modelId: 'gemini-3.5-flash-lite',
      apiKey: 'k',
      prompt: 'hi',
      temperature: 0.1,
    }).body
  );
  assert.equal(liteReq.generationConfig.thinkingConfig, undefined);

  const flashReq = JSON.parse(
    buildTextStepHttpRequest({
      modelId: 'gemini-3-flash-preview',
      apiKey: 'k',
      prompt: 'hi',
      temperature: 0.85,
    }).body
  );
  assert.equal(flashReq.generationConfig.thinkingConfig.thinkingBudget, 0);

  const imgReq = JSON.parse(
    buildImageStepHttpRequest({
      modelId: 'gemini-3.1-flash-lite-image',
      apiKey: 'k',
      prompt: 'scene',
      temperature: 0.6,
    }).body
  );
  assert.equal(imgReq.generationConfig.imageConfig.aspectRatio, '1:1');

  const extracted = extractTextStepOutput('gemini', 'gemini-3-flash-preview', {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'secret thought' },
            { text: 'Visible scene output.' },
          ],
        },
      },
    ],
  });
  assert.equal(extracted.text, 'Visible scene output.');
});

test('Step compiler strips CJK from image_prompt and enforces 15% margin + zero-text guardrail', () => {
  const owl = lookupHanziTarget('猫头鹰', 'compound_word');
  const step1Prompt = compileMnemonicStepInstruction({
    template: 'Map {{lookup_json}} for {{input}}',
    lookup: owl,
    chainName: 'Compound Word',
    personaStyle: 'Pedagogical',
    priorOutputs: [],
  });
  assert.match(step1Prompt, /ordinary owl/);

  const { card, imagePrompt } = compileCardFromTextTraces({
    lookup: owl,
    rawStepText: JSON.stringify({
      mnemonic_hook: 'An eagle with a cat head.',
      image_prompt: 'A golden eagle (鹰) with a ginger cat (猫) head perched on a branch.',
      legend_items: [{ part_number: 1, scene_cue: 'ginger cat face' }],
    }),
    textOnlyPreview: false,
  });

  assert.equal(/[\u4e00-\u9fff]/.test(imagePrompt), false, 'imagePrompt must contain 0 CJK characters');
  assert.match(imagePrompt, /15% empty neutral cream margin/);
  assert.match(imagePrompt, /STRICTLY ZERO TEXT/);
  assert.equal(card.legend_items[0].scene_cue, 'ginger cat face');
  assert.equal(owl.parts[2].gloss, 'eagle, falcon');
  assert.equal(lookupHanziTarget('眼镜', 'compound_word').parts[0].gloss, 'eye');
  assert.equal(
    conciseGloss('general term for a bird of prey (eagle, hawk)'),
    'bird of prey'
  );

  // V1: truncateAtWordBoundary + normalizeStoredCard strip mid-word fragments & dangling stopwords
  assert.equal(
    truncateAtWordBoundary(
      'A tall, branching evergreen pine tree with needle clusters and a crimson-red accessory tint',
      64
    ),
    'A tall, branching evergreen pine tree with needle clusters'
  );
  assert.equal(
    truncateAtWordBoundary(
      'A polished, thick glass optical lens, cobalt-blue in color, positioned directly beneath the hand',
      64
    ),
    'A polished, thick glass optical lens, cobalt-blue in color'
  );

  // V2: formatLiveTracePreview strips Markdown asterisks/bullets cleanly
  const cleanLive = formatLiveTracePreview(
    '**Character Analysis for 松鼠:**\n* **Part 1: 松** (`sōng`)\n* **Role:** MEANING'
  );
  assert.equal(cleanLive.includes('**'), false);
  assert.equal(cleanLive.includes('`'), false);
  assert.match(cleanLive, /Character Analysis for 松鼠/);

  // V3: Sound + Meaning scene_checklist uses primary noun before comma ("gate bell", never "gate, door, entrance, opening bell")
  const wen = lookupHanziTarget('问', 'sound_meaning');
  const normalizedWen = normalizeStoredCard(
    {
      legend_items: [
        { part_number: 1, glyph: '口', pinyin: 'kǒu', gloss: 'mouth', role: 'MEANING', scene_cue: 'crimson mouth shouting at' },
        { part_number: 2, glyph: '门', pinyin: 'mén', gloss: 'gate, door, entrance, opening', role: 'SOUND_ONLY', scene_cue: 'cobalt gate with brass bell' },
      ],
      scene_checklist: '① mouth + ② gate, door, entrance, opening bell (sound wèn) (0 text in image)',
    },
    wen,
    true
  );
  assert.equal(normalizedWen.legend_items[0].scene_cue, 'crimson mouth shouting');
  assert.equal(normalizedWen.scene_checklist, '① mouth + ② gate bell (sound wèn) (0 text in image)');
});

test('UX, license, showcase, and source hygiene checks', () => {
  assert.equal(HANZI_METHOD_TABS.length, 3);
  for (const fname of [
    'licenses/COPYING',
    'licenses/LGPL',
    'licenses/APL/english/ARPHICPL.TXT',
    'licenses/CC-CEDICT-LICENSE.txt',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, fname)), true, `Missing license file: ${fname}`);
  }

  const showcaseFiles = fs.readdirSync(path.join(repoRoot, 'public/showcase'));
  assert.equal(showcaseFiles.filter((f) => f.endsWith('.jpg')).length, 18);

  const srcDir = path.join(repoRoot, 'src');
  const walkFiles = (dir) => {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'data') continue;
        out.push(...walkFiles(full));
      } else if (/\.(ts|tsx|css)$/.test(ent.name)) {
        out.push(full);
      }
    }
    return out;
  };

  const bannedTokens = [
    ['local', 'store'].join('-'),
    ['127.0.0.1', ['189', '91'].join('')].join(':'),
    ['gemini', '3', 'pro', 'image'].join('-'),
    ['#cbf', 'b6d'].join(''),
    ['#101', '210'].join(''),
    '<select',
  ];

  for (const file of walkFiles(srcDir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const bad of bannedTokens) {
      assert.equal(
        content.toLowerCase().includes(bad.toLowerCase()),
        false,
        `Forbidden token "${bad}" found in ${path.relative(repoRoot, file)}`
      );
    }
  }
});

test('PGlite Database A suite: week8 + week9_migration.sql x2 idempotency, co-tenancy, RLS, and reorder RPC', async () => {
  await runMnemonicDbSuite();
});
