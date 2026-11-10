import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractIdeographicParts,
  findComponentPrefixPaths,
  matchStrokeToPart,
  parseIdsTree,
} from './ids';
import {
  BASE_DERIVATIVE_SUGGESTIONS,
  COMPOUND_ANTI_TARGETS,
  DEFAULT_FALLBACK_SAMPLES,
  RADICAL_VARIANT_TABLE,
} from './radicals';
import type {
  DecompositionMode,
  HanziGlyphData,
  HanziPartSpec,
  LookupVerdict,
} from '@/lib/chains/types';

interface RawEtymology {
  type?: string;
  semantic?: string;
  phonetic?: string;
  hint?: string;
}

interface RawDictEntry {
  character: string;
  definition?: string;
  pinyin?: string[];
  decomposition?: string;
  etymology?: RawEtymology;
  radical?: string;
  matches?: Array<number[] | null>;
}

interface CompoundEntry {
  pinyin: string;
  gloss: string;
}

interface LoadedHanziDataset {
  dict: Map<string, RawDictEntry>;
  strokes: Map<string, string[]>;
  compounds: Map<string, CompoundEntry>;
  polyphones: Record<string, Record<string, string>>;
}

const GLOBAL_DATASET_KEY = '__hanziPartsStudioDatasetV1';

const EQUIVALENT_RADICAL_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '人': ['人', '亻'],
  '亻': ['亻', '人'],
  '水': ['水', '氵'],
  '氵': ['氵', '水'],
  '手': ['手', '扌'],
  '扌': ['扌', '手'],
  '心': ['心', '忄'],
  '忄': ['忄', '心'],
  '犬': ['犬', '犭'],
  '犭': ['犭', '犬'],
  '火': ['火', '灬'],
  '灬': ['灬', '火'],
  '艸': ['艸', '艹', '草'],
  '艹': ['艹', '艸', '草'],
  '肉': ['肉', '⺼', '月'],
  '⺼': ['⺼', '月', '肉'],
  '言': ['言', '讠'],
  '讠': ['讠', '言'],
  '金': ['金', '钅'],
  '钅': ['钅', '金'],
  '食': ['食', '饣'],
  '饣': ['饣', '食'],
  '糸': ['糸', '纟'],
  '纟': ['纟', '糸'],
  '辵': ['辵', '辶'],
  '辶': ['辶', '辵'],
  '刀': ['刀', '刂'],
  '刂': ['刂', '刀'],
  '衣': ['衣', '衤'],
  '衤': ['衤', '衣'],
  '示': ['示', '礻'],
  '礻': ['礻', '示'],
  '竹': ['竹', '⺮'],
  '⺮': ['⺮', '竹'],
  '足': ['足', '⻊'],
  '⻊': ['⻊', '足'],
};

function resolveDataDir(): string {
  const cwdCandidate = path.join(process.cwd(), 'src/data');
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  return path.resolve(__dirname, '../../data');
}

export function getHanziDataset(): LoadedHanziDataset {
  const g = globalThis as unknown as Record<string, LoadedHanziDataset | undefined>;
  if (g[GLOBAL_DATASET_KEY]) {
    return g[GLOBAL_DATASET_KEY]!;
  }

  const dataDir = resolveDataDir();
  const dictPath = path.join(dataDir, 'makemeahanzi/dictionary.txt');
  const gfxPath = path.join(dataDir, 'makemeahanzi/graphics.txt');
  const compoundsPath = path.join(dataDir, 'cc-cedict/compounds.tsv');
  const polyPath = path.join(dataDir, 'cc-cedict/polyphones.json');

  const dict = new Map<string, RawDictEntry>();
  const dictLines = fs.readFileSync(dictPath, 'utf8').split('\n');
  for (const rawLine of dictLines) {
    const clean = rawLine.replace(/\u00a0/g, ' ').trim();
    if (!clean) continue;
    const parsed = JSON.parse(clean) as RawDictEntry;
    if (parsed.character) {
      dict.set(parsed.character, parsed);
    }
  }

  const strokes = new Map<string, string[]>();
  const gfxLines = fs.readFileSync(gfxPath, 'utf8').split('\n');
  for (const rawLine of gfxLines) {
    const clean = rawLine.trim();
    if (!clean) continue;
    const parsed = JSON.parse(clean) as { character: string; strokes: string[] };
    if (parsed.character && Array.isArray(parsed.strokes)) {
      strokes.set(parsed.character, parsed.strokes);
    }
  }

  const compounds = new Map<string, CompoundEntry>();
  if (fs.existsSync(compoundsPath)) {
    const compLines = fs.readFileSync(compoundsPath, 'utf8').split('\n');
    for (const rawLine of compLines) {
      if (!rawLine) continue;
      const tab1 = rawLine.indexOf('\t');
      const tab2 = rawLine.indexOf('\t', tab1 + 1);
      if (tab1 > 0 && tab2 > tab1) {
        const word = rawLine.slice(0, tab1);
        const pinyin = rawLine.slice(tab1 + 1, tab2);
        const gloss = rawLine.slice(tab2 + 1).trim();
        compounds.set(word, { pinyin, gloss });
      }
    }
  }

  const polyphones: Record<string, Record<string, string>> = fs.existsSync(polyPath)
    ? (JSON.parse(fs.readFileSync(polyPath, 'utf8')) as Record<string, Record<string, string>>)
    : {};

  const loaded: LoadedHanziDataset = { dict, strokes, compounds, polyphones };
  g[GLOBAL_DATASET_KEY] = loaded;
  return loaded;
}

function cleanComponentGlyph(raw: string | undefined): string {
  if (!raw) return '';
  const stripped = raw.replace(/[\s\u00a0]+/g, '').trim();
  if (!stripped || stripped === '?' || stripped === '？') {
    return '';
  }
  return Array.from(stripped)[0] ?? '';
}

export function conciseGloss(rawDef: string | undefined, fallback = 'component'): string {
  const cleaned = (rawDef ?? '').replace(/\u00a0/g, ' ').trim();
  if (!cleaned) return fallback;
  const primary = cleaned
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^surname\b/i.test(s) && !/^variant of\b/i.test(s));
  let chosen = (primary[0] ?? cleaned)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/^(?:general|generic)\s+term\s+for\s+(?:a|an)\s+/i, '')
    .trim();
  const commaParts = chosen
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length > 2) {
    chosen = commaParts.slice(0, 2).join(', ');
  }
  return chosen || fallback;
}

function lookupComponentInfo(
  glyph: string,
  ds: LoadedHanziDataset,
  preferredSyllable?: string
): { pinyin: string; gloss: string } {
  const radicalHit = RADICAL_VARIANT_TABLE[glyph];
  const dictHit = ds.dict.get(glyph);
  const polyMap = ds.polyphones[glyph];
  const polyEntry = preferredSyllable ? polyMap?.[preferredSyllable] : undefined;

  if (preferredSyllable && polyEntry && !/^(?:general|generic)\s+term\s+for\b/i.test(polyEntry.trim())) {
    return {
      pinyin: preferredSyllable,
      gloss: conciseGloss(polyEntry, radicalHit?.gloss ?? 'part'),
    };
  }

  const rawPinyin =
    preferredSyllable ||
    dictHit?.pinyin?.[0]?.trim() ||
    radicalHit?.pinyin ||
    '';

  if (radicalHit && (!dictHit?.definition || glyph !== dictHit.character || dictHit.pinyin?.length === 0)) {
    return {
      pinyin: rawPinyin || radicalHit.pinyin,
      gloss: radicalHit.gloss,
    };
  }

  const defGloss = conciseGloss(dictHit?.definition, radicalHit?.gloss ?? 'component');
  return {
    pinyin: rawPinyin || radicalHit?.pinyin || '',
    gloss: defGloss,
  };
}

function findPathsWithVariants(decomposition: string, targetGlyph: string): number[][] {
  const candidates = EQUIVALENT_RADICAL_GLYPHS[targetGlyph] ?? [targetGlyph];
  for (const cand of candidates) {
    const found = findComponentPrefixPaths(decomposition, cand);
    if (found.length > 0) return found;
  }
  return [];
}

function formatModeDisplayName(mode: DecompositionMode): string {
  if (mode === 'compound_word') return 'Compound Word';
  if (mode === 'compound_idea') return 'Compound Idea';
  if (mode === 'sound_meaning') return 'Sound + Meaning';
  return 'Flexible Lookup';
}

export function lookupHanziTarget(
  rawInput: string,
  requestedMode: DecompositionMode = 'compound_word'
): LookupVerdict {
  const ds = getHanziDataset();
  const trimmed = (rawInput ?? '').replace(/[\s\u00a0]+/g, '').trim();
  const chars = Array.from(trimmed);

  if (chars.length === 0 || chars.length > 4 || !chars.every((c) => /\p{Script=Han}/u.test(c))) {
    return {
      ok: false,
      status: 'invalid',
      input: trimmed,
      pinyin: '',
      english_meaning: '',
      decomposition_label: '',
      etymology_type: 'invalid',
      etymology_hint: '',
      requested_mode: requestedMode,
      effective_mode: 'compound_word',
      fitting_chain_slug: null,
      fitting_chain_name: null,
      mismatch_title: 'Enter 1 to 4 Simplified Chinese characters',
      mismatch_reason:
        'Enter 1 to 4 Simplified Chinese characters (or click any 1-Click Sample chip on the left).',
      suggested_samples: [...DEFAULT_FALLBACK_SAMPLES],
      anti_target: '',
      glyphs: [],
      parts: [],
    };
  }

  const missingChar = chars.find((c) => !ds.dict.has(c) || !ds.strokes.has(c));
  if (missingChar) {
    return {
      ok: false,
      status: 'invalid',
      input: trimmed,
      pinyin: '',
      english_meaning: '',
      decomposition_label: '',
      etymology_type: 'unsupported_hanzi',
      etymology_hint: '',
      requested_mode: requestedMode,
      effective_mode: 'compound_word',
      fitting_chain_slug: null,
      fitting_chain_name: null,
      mismatch_title: `“${missingChar}” is outside the 9,574-character Simplified stroke dataset`,
      mismatch_reason:
        'Please enter Simplified Chinese characters covered by Make Me a Hanzi (or click a sample chip).',
      suggested_samples: [...DEFAULT_FALLBACK_SAMPLES],
      anti_target: '',
      glyphs: [],
      parts: [],
    };
  }

  // Case 1: 2..4 character Compound Word
  if (chars.length >= 2) {
    const compoundHit = ds.compounds.get(trimmed);
    const compoundSyls = compoundHit ? compoundHit.pinyin.split(/\s+/) : [];

    const parts: HanziPartSpec[] = chars.map((ch, idx) => {
      const alignedSyl = compoundSyls[idx];
      const info = lookupComponentInfo(ch, ds, alignedSyl);
      return {
        part_number: idx + 1,
        glyph: ch,
        pinyin: info.pinyin,
        gloss: info.gloss,
        role: 'MEANING',
        role_badge: `MEANING PART ${idx + 1}`,
      };
    });

    const glyphs: HanziGlyphData[] = chars.map((ch, idx) => {
      const chStrokes = ds.strokes.get(ch) ?? [];
      return {
        character: ch,
        strokes: chStrokes,
        strokePartIndex: chStrokes.map(() => idx + 1),
      };
    });

    const wordPinyin = compoundHit?.pinyin || parts.map((p) => p.pinyin).join(' ');
    const wordMeaning =
      compoundHit ? conciseGloss(compoundHit.gloss, parts.map((p) => p.gloss).join(' + ')) : parts.map((p) => p.gloss).join(' + ');
    const decompLabel = `${parts.map((p) => `${p.glyph} (${p.pinyin}, ${p.gloss})`).join(' + ')} → ${wordMeaning}`;
    const antiTarget =
      COMPOUND_ANTI_TARGETS[trimmed] ??
      `an ordinary literal ${wordMeaning} (depict the component parts ${parts.map((p) => p.gloss).join(' + ')} combined instead)`;

    const fitsRequested = requestedMode === 'compound_word' || requestedMode === 'flexible';
    return {
      ok: true,
      status: fitsRequested ? 'fit' : 'fit_mismatch',
      input: trimmed,
      pinyin: wordPinyin,
      english_meaning: wordMeaning,
      decomposition_label: decompLabel,
      etymology_type: 'compound_word',
      etymology_hint: `Multi-character compound word (${chars.length} characters)`,
      requested_mode: requestedMode,
      effective_mode: 'compound_word',
      fitting_chain_slug: 'compound-word',
      fitting_chain_name: 'Compound Word',
      mismatch_title: fitsRequested ? null : `Why “${trimmed}” belongs in Compound Word`,
      mismatch_reason: fitsRequested
        ? null
        : `${formatModeDisplayName(requestedMode)} decomposes a single character into sub-character parts. “${trimmed}” (${wordPinyin}, ${wordMeaning}) is a ${chars.length}-character word whose characters each contribute a meaning: ${parts.map((p) => `${p.glyph} (${p.gloss})`).join(' + ')}.`,
      suggested_samples: [],
      anti_target: antiTarget,
      glyphs,
      parts,
    };
  }

  // Case 2: Single character
  const ch = chars[0];
  const entry = ds.dict.get(ch)!;
  const chStrokes = ds.strokes.get(ch)!;
  const rawMatches = entry.matches ?? [];
  const decomp = (entry.decomposition ?? '').trim();
  const charPinyin = entry.pinyin?.[0]?.trim() || RADICAL_VARIANT_TABLE[ch]?.pinyin || '';
  const charMeaning = conciseGloss(entry.definition, RADICAL_VARIANT_TABLE[ch]?.gloss ?? ch);
  const etymType = (entry.etymology?.type ?? 'pictographic').trim();
  const etymHint = (entry.etymology?.hint ?? '').replace(/\u00a0/g, ' ').trim();

  const semGlyph = cleanComponentGlyph(entry.etymology?.semantic);
  const phoGlyph = cleanComponentGlyph(entry.etymology?.phonetic);
  const isCompletePictophonetic =
    etymType === 'pictophonetic' && semGlyph.length > 0 && phoGlyph.length > 0;

  // Subcase 2A: Complete Sound + Meaning (pictophonetic) character
  if (isCompletePictophonetic) {
    let semPaths = findPathsWithVariants(decomp, semGlyph);
    let phoPaths = findPathsWithVariants(decomp, phoGlyph);

    const root = parseIdsTree(decomp);
    if (root && root.children.length === 2) {
      if (semPaths.length > 0 && phoPaths.length === 0 && semPaths[0].length === 1) {
        phoPaths = [[1 - semPaths[0][0]]];
      } else if (phoPaths.length > 0 && semPaths.length === 0 && phoPaths[0].length === 1) {
        semPaths = [[1 - phoPaths[0][0]]];
      } else if (semPaths.length === 0 && phoPaths.length === 0) {
        semPaths = [[0]];
        phoPaths = [[1]];
      }
    }

    const semInfo = lookupComponentInfo(semGlyph, ds);
    const phoInfo = lookupComponentInfo(phoGlyph, ds);

    const strokePartIndex = chStrokes.map((_, sIdx) =>
      matchStrokeToPart(rawMatches[sIdx] ?? null, [semPaths, phoPaths])
    );

    const parts: HanziPartSpec[] = [
      {
        part_number: 1,
        glyph: semGlyph,
        pinyin: semInfo.pinyin,
        gloss: semInfo.gloss,
        role: 'MEANING',
        role_badge: 'MEANING PART',
      },
      {
        part_number: 2,
        glyph: phoGlyph,
        pinyin: phoInfo.pinyin,
        gloss: phoInfo.gloss,
        role: 'SOUND_ONLY',
        role_badge: '♪ SOUND PART · FOR PRONUNCIATION ONLY',
        sound_note: `cues sound ${charPinyin}, not meaning`,
      },
    ];

    const fitsRequested = requestedMode === 'sound_meaning' || requestedMode === 'flexible';
    const mismatchReason =
      requestedMode === 'compound_idea'
        ? `Compound Idea expects every part to contribute meaning (like 休 = person + tree → rest). In “${ch}” (${charPinyin}, ${charMeaning}), Make Me a Hanzi records ${semGlyph} (${semInfo.gloss}) for meaning, while ${phoGlyph} (${phoInfo.gloss}, ${phoInfo.pinyin}) is strictly a sound component. Inventing a story about why “${charMeaning}” is a “${phoInfo.gloss}” would teach something false.`
        : `Compound Word explains 2-to-4 character words built from whole characters. “${ch}” (${charPinyin}, ${charMeaning}) is a single Sound + Meaning character pairing meaning part ${semGlyph} (${semInfo.gloss}) with sound part ${phoGlyph} (${phoInfo.pinyin} → sounds like ${charPinyin}).`;

    return {
      ok: true,
      status: fitsRequested ? 'fit' : 'fit_mismatch',
      input: ch,
      pinyin: charPinyin,
      english_meaning: charMeaning,
      decomposition_label: `Meaning: ${semGlyph} (${semInfo.gloss}) · Sound: ${phoGlyph} (${phoInfo.pinyin} → sounds like ${charPinyin})`,
      etymology_type: 'pictophonetic',
      etymology_hint: etymHint || `Meaning ${semGlyph} + phonetic ${phoGlyph}`,
      requested_mode: requestedMode,
      effective_mode: 'sound_meaning',
      fitting_chain_slug: 'sound-meaning',
      fitting_chain_name: 'Sound + Meaning',
      mismatch_title: fitsRequested ? null : `Why “${ch}” belongs in Sound + Meaning`,
      mismatch_reason: fitsRequested ? null : mismatchReason,
      suggested_samples: [],
      anti_target: `an ungrounded generic illustration omitting either ${semInfo.gloss} or ${phoInfo.gloss} with its sound bell/horn`,
      glyphs: [{ character: ch, strokes: chStrokes, strokePartIndex }],
      parts,
    };
  }

  // Subcase 2B: Compound Idea (ideographic) character with 2..4 sub-character parts
  const ideoLeaves = extractIdeographicParts(decomp);
  if (etymType === 'ideographic' && ideoLeaves.length >= 2) {
    const glyphCounts = new Map<string, number>();
    for (const lf of ideoLeaves) {
      glyphCounts.set(lf.glyph, (glyphCounts.get(lf.glyph) ?? 0) + 1);
    }
    const seenIndex = new Map<string, number>();

    const parts: HanziPartSpec[] = ideoLeaves.map((lf, idx) => {
      const info = lookupComponentInfo(lf.glyph, ds);
      const totalSame = glyphCounts.get(lf.glyph) ?? 1;
      const curSame = (seenIndex.get(lf.glyph) ?? 0) + 1;
      seenIndex.set(lf.glyph, curSame);

      let positionTag = '';
      if (totalSame === 3) {
        positionTag = curSame === 1 ? ' (top)' : curSame === 2 ? ' (bottom-left)' : ' (bottom-right)';
      } else if (totalSame === 2) {
        positionTag = curSame === 1 ? ' (first)' : ' (second)';
      }

      return {
        part_number: idx + 1,
        glyph: lf.glyph,
        pinyin: info.pinyin,
        gloss: `${info.gloss}${positionTag}`,
        role: 'MEANING',
        role_badge: 'MEANING PART',
      };
    });

    const strokePartIndex = chStrokes.map((_, sIdx) =>
      matchStrokeToPart(
        rawMatches[sIdx] ?? null,
        ideoLeaves.map((lf) => lf.paths)
      )
    );

    const fitsRequested = requestedMode === 'compound_idea' || requestedMode === 'flexible';
    const mismatchReason =
      requestedMode === 'sound_meaning'
        ? `Sound + Meaning expects one meaning radical paired with a pronunciation-only part (like 妈 = woman + horse sound). In “${ch}” (${charPinyin}, ${charMeaning}), Make Me a Hanzi records an ideographic Compound Idea where every part contributes meaning (${parts.map((p) => `${p.glyph} = ${p.gloss}`).join(' + ')}) with no sound-only part.`
        : `Compound Word explains 2-to-4 character words built from whole characters. “${ch}” (${charPinyin}, ${charMeaning}) is a single Compound Idea character combining ${parts.map((p) => `${p.glyph} (${p.gloss})`).join(' + ')}.`;

    return {
      ok: true,
      status: fitsRequested ? 'fit' : 'fit_mismatch',
      input: ch,
      pinyin: charPinyin,
      english_meaning: charMeaning,
      decomposition_label: `${parts.map((p) => `${p.glyph} (${p.gloss})`).join(' + ')} → ${charMeaning}`,
      etymology_type: 'ideographic',
      etymology_hint: etymHint || `${parts.map((p) => p.glyph).join(' + ')}`,
      requested_mode: requestedMode,
      effective_mode: 'compound_idea',
      fitting_chain_slug: 'compound-idea',
      fitting_chain_name: 'Compound Idea',
      mismatch_title: fitsRequested ? null : `Why “${ch}” belongs in Compound Idea`,
      mismatch_reason: fitsRequested ? null : mismatchReason,
      suggested_samples: [],
      anti_target: `an abstract scene that omits the literal parts ${parts.map((p) => p.gloss).join(' and ')}`,
      glyphs: [{ character: ch, strokes: chStrokes, strokePartIndex }],
      parts,
    };
  }

  // Subcase 2C: Base Pictograph OR Incomplete Simplified Pictophonetic (e.g. 脑 lacking phonetic)
  const suggestions = [
    ...(BASE_DERIVATIVE_SUGGESTIONS[ch] ?? DEFAULT_FALLBACK_SAMPLES),
  ];

  const isIncompletePictophonetic = etymType === 'pictophonetic';
  const semDisplay = semGlyph
    ? `${semGlyph} (${lookupComponentInfo(semGlyph, ds).gloss})`
    : 'its radical';

  return {
    ok: true,
    status: 'base_pictograph',
    input: ch,
    pinyin: charPinyin,
    english_meaning: charMeaning,
    decomposition_label: isIncompletePictophonetic
      ? `Simplified script retains ${semDisplay} without a standalone phonetic part`
      : `Foundational single-part character (${etymType})`,
    etymology_type: isIncompletePictophonetic ? 'pictophonetic_incomplete' : etymType,
    etymology_hint: etymHint,
    requested_mode: requestedMode,
    effective_mode: 'compound_idea',
    fitting_chain_slug: suggestions[0]?.chain_slug ?? 'compound-word',
    fitting_chain_name: null,
    mismatch_title: isIncompletePictophonetic
      ? `“${ch}” has no standalone phonetic part in simplified script`
      : `“${ch}” is a foundational base pictograph`,
    mismatch_reason: isIncompletePictophonetic
      ? `Make Me a Hanzi records simplified “${ch}” (${charPinyin}, ${charMeaning}) with meaning radical ${semDisplay}, while its historical sound component was contracted during script simplification. Rather than inventing a false origin, try a compound word or character below:`
      : `Make Me a Hanzi records “${ch}” (${charPinyin}, ${charMeaning}) as a foundational ${etymType} character${etymHint ? ` (${etymHint})` : ''} rather than a multi-part combination. Try a word or character that builds on it:`,
    suggested_samples: suggestions,
    anti_target: '',
    glyphs: [
      {
        character: ch,
        strokes: chStrokes,
        strokePartIndex: chStrokes.map(() => 1),
      },
    ],
    parts: [
      {
        part_number: 1,
        glyph: ch,
        pinyin: charPinyin,
        gloss: charMeaning,
        role: 'MEANING',
        role_badge: 'BASE CHARACTER',
      },
    ],
  };
}
