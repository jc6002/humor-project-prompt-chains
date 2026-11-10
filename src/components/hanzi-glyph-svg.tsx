'use client';

import type { HanziGlyphData } from '@/lib/chains/types';

interface HanziGlyphSvgProps {
  glyphs: readonly HanziGlyphData[];
  highlightedPart: number | null;
}

function strokeFillColor(partIndex: number): string {
  if (partIndex === 1) return 'var(--part-1)';
  if (partIndex === 2) return 'var(--part-2)';
  if (partIndex === 3) return 'var(--part-3)';
  if (partIndex === 4) return 'var(--part-4)';
  return 'var(--stroke-neutral)';
}

export function HanziGlyphSvg({ glyphs, highlightedPart }: HanziGlyphSvgProps) {
  const count = Math.min(4, Math.max(1, glyphs.length));

  return (
    <div
      className="glyph-row"
      data-highlight-part={highlightedPart ?? undefined}
      aria-label={`Stroke decomposition for ${glyphs.map((g) => g.character).join('')}`}
    >
      {glyphs.map((glyph, gIdx) => (
        <div key={`${gIdx}-${glyph.character}`} className={`mizige-tile count-${count}`}>
          <svg
            viewBox="0 0 1024 1024"
            width="100%"
            height="100%"
            role="img"
            aria-label={`Character ${glyph.character}`}
          >
            {/* Subtle mǐzìgé calligraphy guide grid */}
            <g
              stroke="var(--fg-muted)"
              strokeOpacity="0.16"
              strokeWidth="8"
              strokeDasharray="24 20"
            >
              <line x1="512" y1="0" x2="512" y2="1024" />
              <line x1="0" y1="512" x2="1024" y2="512" />
              <line x1="0" y1="0" x2="1024" y2="1024" />
              <line x1="1024" y1="0" x2="0" y2="1024" />
            </g>

            {/* Make Me a Hanzi stroke coordinate space */}
            <g transform="scale(1, -1) translate(0, -900)">
              {glyph.strokes.map((d, sIdx) => {
                const pIdx = glyph.strokePartIndex[sIdx] ?? 0;
                const dimmed = highlightedPart !== null && pIdx !== highlightedPart;
                return (
                  <path
                    key={sIdx}
                    d={d}
                    fill={strokeFillColor(pIdx)}
                    fillOpacity={dimmed ? 0.2 : 1}
                    style={{ transition: 'fill-opacity 0.14s ease' }}
                  />
                );
              })}
            </g>
          </svg>
        </div>
      ))}
    </div>
  );
}
