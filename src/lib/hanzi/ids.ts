// Recursive parser for Unicode Ideographic Description Sequences (IDS) in Make Me a Hanzi.

const IDS_ARITY: Readonly<Record<string, number>> = {
  '⿰': 2,
  '⿱': 2,
  '⿲': 3,
  '⿳': 3,
  '⿴': 2,
  '⿵': 2,
  '⿶': 2,
  '⿷': 2,
  '⿸': 2,
  '⿹': 2,
  '⿺': 2,
  '⿻': 2,
};

export interface IdsNode {
  glyph: string;
  path: number[];
  children: IdsNode[];
}

export function parseIdsTree(decomposition: string): IdsNode | null {
  const tokens = Array.from((decomposition ?? '').trim());
  if (tokens.length === 0) return null;

  let cursor = 0;

  const parseAt = (path: number[]): IdsNode => {
    if (cursor >= tokens.length) {
      return { glyph: '？', path, children: [] };
    }
    const ch = tokens[cursor++];
    const arity = IDS_ARITY[ch];
    if (!arity) {
      return { glyph: ch, path, children: [] };
    }
    const children: IdsNode[] = [];
    for (let idx = 0; idx < arity; idx++) {
      children.push(parseAt([...path, idx]));
    }
    return { glyph: ch, path, children };
  };

  return parseAt([]);
}

export interface IdsLeafPart {
  glyph: string;
  paths: number[][];
}

// Extracts 2..4 distinct leaf components for Compound Idea characters (e.g. 森 -> [0], [1,0], [1,1]).
export function extractIdeographicParts(decomposition: string): IdsLeafPart[] {
  const root = parseIdsTree(decomposition);
  if (!root || root.children.length === 0) {
    return [];
  }

  const leaves: Array<{ glyph: string; path: number[] }> = [];
  const collectLeaves = (node: IdsNode): void => {
    if (node.children.length === 0) {
      if (node.glyph && node.glyph !== '？' && node.glyph !== '?') {
        leaves.push({ glyph: node.glyph, path: node.path });
      }
      return;
    }
    for (const child of node.children) {
      collectLeaves(child);
    }
  };
  collectLeaves(root);

  if (leaves.length >= 2 && leaves.length <= 4) {
    return leaves.map((leaf) => ({ glyph: leaf.glyph, paths: [leaf.path] }));
  }

  // When deeper leaves exceed 4, group cleanly by top-level children so colours stay within 1..4.
  return root.children
    .filter((child) => child.glyph !== '？' && child.glyph !== '?')
    .slice(0, 4)
    .map((child) => ({
      glyph: flattenSubtreeLabel(child),
      paths: [child.path],
    }));
}

function flattenSubtreeLabel(node: IdsNode): string {
  if (node.children.length === 0) return node.glyph;
  const sub = node.children
    .map((c) => flattenSubtreeLabel(c))
    .filter((g) => g && g !== '？' && g !== '?');
  return sub[0] ?? node.glyph;
}

// Finds all IDS node prefix paths matching a target semantic or phonetic component (e.g. 青 at [1] in 清).
export function findComponentPrefixPaths(decomposition: string, targetGlyph: string): number[][] {
  const cleanTarget = targetGlyph.trim();
  if (!cleanTarget) return [];
  const root = parseIdsTree(decomposition);
  if (!root) return [];

  const matched: number[][] = [];
  const visit = (node: IdsNode): boolean => {
    if (node.glyph === cleanTarget && node.path.length > 0) {
      matched.push(node.path);
      return true;
    }
    let anyChild = false;
    for (const child of node.children) {
      if (visit(child)) {
        anyChild = true;
      }
    }
    return anyChild;
  };
  visit(root);
  return matched;
}

// Maps a Make Me a Hanzi stroke match path (or null) to 1-based part index (0 = neutral stroke).
export function matchStrokeToPart(
  strokeMatch: readonly number[] | null | undefined,
  partPrefixPaths: ReadonlyArray<ReadonlyArray<readonly number[]>>
): number {
  if (!strokeMatch || strokeMatch.length === 0) {
    return 0;
  }

  let bestPart = 0;
  let bestDepth = -1;

  for (let pIdx = 0; pIdx < partPrefixPaths.length; pIdx++) {
    const prefixes = partPrefixPaths[pIdx];
    for (const prefix of prefixes) {
      if (prefix.length === 0 || prefix.length > strokeMatch.length) continue;
      const isPrefix = prefix.every((seg, i) => strokeMatch[i] === seg);
      if (isPrefix && prefix.length > bestDepth) {
        bestDepth = prefix.length;
        bestPart = pIdx + 1;
      }
    }
  }

  return bestPart;
}
