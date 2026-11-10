import type { SuggestedSampleChip } from '@/lib/chains/types';

export interface RadicalVariantInfo {
  pinyin: string;
  gloss: string;
  visualNoun: string;
}

// Canonical 28-entry bound-radical lookup so component pinyin and glosses are never empty or cryptic.
export const RADICAL_VARIANT_TABLE: Readonly<Record<string, RadicalVariantInfo>> = {
  '亻': { pinyin: 'rén', gloss: 'person', visualNoun: 'standing traveler person' },
  '人': { pinyin: 'rén', gloss: 'person', visualNoun: 'person' },
  '氵': { pinyin: 'shuǐ', gloss: 'water', visualNoun: 'splashing water droplets and waves' },
  '水': { pinyin: 'shuǐ', gloss: 'water', visualNoun: 'flowing clear water' },
  '⺼': { pinyin: 'ròu', gloss: 'flesh / body', visualNoun: 'living body form' },
  '扌': { pinyin: 'shǒu', gloss: 'hand', visualNoun: 'open reaching hand and arm' },
  '手': { pinyin: 'shǒu', gloss: 'hand', visualNoun: 'open hand' },
  '忄': { pinyin: 'xīn', gloss: 'heart', visualNoun: 'glowing heart' },
  '心': { pinyin: 'xīn', gloss: 'heart', visualNoun: 'glowing heart' },
  '讠': { pinyin: 'yán', gloss: 'speech / words', visualNoun: 'ringing speaking horn' },
  '言': { pinyin: 'yán', gloss: 'speech / words', visualNoun: 'speaking scroll' },
  '钅': { pinyin: 'jīn', gloss: 'metal / gold', visualNoun: 'gleaming forged metal ingot' },
  '金': { pinyin: 'jīn', gloss: 'gold / metal', visualNoun: 'gleaming gold ingot' },
  '饣': { pinyin: 'shí', gloss: 'food', visualNoun: 'steaming rice bowl' },
  '食': { pinyin: 'shí', gloss: 'food', visualNoun: 'steaming feast bowl' },
  '纟': { pinyin: 'mì', gloss: 'silk thread', visualNoun: 'woven silk spool' },
  '辶': { pinyin: 'chuò', gloss: 'walking road', visualNoun: 'winding cobblestone path' },
  '艹': { pinyin: 'cǎo', gloss: 'grass / plant', visualNoun: 'sprouting green meadow grass' },
  '囗': { pinyin: 'wéi', gloss: 'four-sided enclosure', visualNoun: 'thick four-walled square stone enclosure' },
  '灬': { pinyin: 'huǒ', gloss: 'fire / embers', visualNoun: 'crackling campfire flames below' },
  '火': { pinyin: 'huǒ', gloss: 'fire', visualNoun: 'roaring campfire flames' },
  '刂': { pinyin: 'dāo', gloss: 'knife blade', visualNoun: 'polished carving blade' },
  '阝': { pinyin: 'fù', gloss: 'terraced mound / hill', visualNoun: 'stepped earthen hillside' },
  '犭': { pinyin: 'quǎn', gloss: 'animal / hound', visualNoun: 'alert furry creature' },
  '疒': { pinyin: 'nè', gloss: 'resting sickbed', visualNoun: 'wooden resting cot' },
  '礻': { pinyin: 'shì', gloss: 'altar / spirit', visualNoun: 'carved stone lantern altar' },
  '衤': { pinyin: 'yī', gloss: 'garment / cloak', visualNoun: 'woven cloth robe' },
  '⺮': { pinyin: 'zhú', gloss: 'bamboo', visualNoun: 'jointed green bamboo stalks' },
  '竹': { pinyin: 'zhú', gloss: 'bamboo', visualNoun: 'jointed green bamboo stalks' },
  '⻊': { pinyin: 'zú', gloss: 'foot', visualNoun: 'stepping booted foot' },
  '足': { pinyin: 'zú', gloss: 'foot', visualNoun: 'stepping foot' },
  '宀': { pinyin: 'mián', gloss: 'roof / house', visualNoun: 'tiled cottage roof overhead' },
  '冖': { pinyin: 'mì', gloss: 'cover cloth', visualNoun: 'draped canopy cover' },
  '广': { pinyin: 'guǎng', gloss: 'open pavilion shelter', visualNoun: 'open timber shelter roof' },
  '厂': { pinyin: 'hǎn', gloss: 'cliff overhang', visualNoun: 'rocky cliff overhang' },
  '页': { pinyin: 'yè', gloss: 'head / page', visualNoun: 'expressive head profile' },
  '青': { pinyin: 'qīng', gloss: 'blue-green sprout', visualNoun: 'vivid blue-green sprouting bamboo shoot' },
};

// Explicit anti-target guards for popular compound words so Step 4 draws the literal parts, never the ordinary target look.
export const COMPOUND_ANTI_TARGETS: Readonly<Record<string, string>> = {
  猫头鹰: 'an ordinary owl or owl face (must be an eagle body with a house cat head)',
  电脑: 'a laptop, desktop monitor, screen, keyboard, or phone (must be electric lightning + anatomical brain)',
  长颈鹿: 'an ordinary savanna giraffe with stubby ossicones (must be an antlered woodland deer with an impossibly stretched neck)',
  熊猫: 'a black-and-white giant panda or bamboo (must be a brown grizzly bear combined with a whiskered house cat)',
  袋鼠: 'an Australian kangaroo (must be a plump whiskered mouse wearing a giant front cloth pouch)',
  火车: 'a modern subway or sleek bullet train without flames (must be roaring fire riding in a wheeled cart)',
  松鼠: 'an ordinary squirrel alone (must clearly show a pine tree + a whiskered mouse)',
  眼镜: 'ordinary wire-frame eyeglasses on a table (must clearly show a large expressive eye + an ornate mirror)',
  海豚: 'an ordinary grey dolphin (must show rolling ocean waves + a plump pink piglet leaping through the sea)',
};

// Helpful derivative suggestions when a learner enters a base pictograph or incomplete single character.
export const BASE_DERIVATIVE_SUGGESTIONS: Readonly<Record<string, readonly SuggestedSampleChip[]>> = {
  木: [
    { hanzi: '休', gloss: 'to rest (person + tree)', chain_slug: 'compound-idea' },
    { hanzi: '森', gloss: 'forest (three trees)', chain_slug: 'compound-idea' },
    { hanzi: '沐', gloss: 'to bathe (water + tree sound)', chain_slug: 'sound-meaning' },
  ],
  人: [
    { hanzi: '休', gloss: 'to rest (person + tree)', chain_slug: 'compound-idea' },
    { hanzi: '囚', gloss: 'prisoner (box + person)', chain_slug: 'compound-idea' },
  ],
  水: [
    { hanzi: '泪', gloss: 'tears (water + eye)', chain_slug: 'compound-idea' },
    { hanzi: '洋', gloss: 'ocean (water + sheep sound)', chain_slug: 'sound-meaning' },
    { hanzi: '清', gloss: 'clear (water + green sound)', chain_slug: 'sound-meaning' },
  ],
  女: [{ hanzi: '妈', gloss: 'mother (woman + horse sound)', chain_slug: 'sound-meaning' }],
  马: [
    { hanzi: '妈', gloss: 'mother (woman + horse sound)', chain_slug: 'sound-meaning' },
    { hanzi: '骑', gloss: 'to ride (horse + odd sound)', chain_slug: 'sound-meaning' },
  ],
  日: [
    { hanzi: '明', gloss: 'bright (sun + moon)', chain_slug: 'compound-idea' },
    { hanzi: '晴', gloss: 'sunny (sun + qing sound)', chain_slug: 'sound-meaning' },
  ],
  月: [{ hanzi: '明', gloss: 'bright (sun + moon)', chain_slug: 'compound-idea' }],
  目: [
    { hanzi: '泪', gloss: 'tears (water + eye)', chain_slug: 'compound-idea' },
    { hanzi: '看', gloss: 'to look (hand over eye)', chain_slug: 'compound-idea' },
  ],
  脑: [{ hanzi: '电脑', gloss: 'computer (electric + brain)', chain_slug: 'compound-word' }],
  猫: [
    { hanzi: '猫头鹰', gloss: 'owl (cat + head + eagle)', chain_slug: 'compound-word' },
    { hanzi: '熊猫', gloss: 'panda (bear + cat)', chain_slug: 'compound-word' },
  ],
};

export const DEFAULT_FALLBACK_SAMPLES: readonly SuggestedSampleChip[] = [
  { hanzi: '猫头鹰', gloss: 'owl (cat + head + eagle)', chain_slug: 'compound-word' },
  { hanzi: '休', gloss: 'to rest (person + tree)', chain_slug: 'compound-idea' },
  { hanzi: '妈', gloss: 'mother (woman + horse sound)', chain_slug: 'sound-meaning' },
];
