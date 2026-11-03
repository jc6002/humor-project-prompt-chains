import type { StepExecutionTrace } from './types';

export const CHAIN_UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const ALLOWED_VISION_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const STEP_ROLE_OPTIONS = [
  { value: 'vision_analysis', label: 'vision_analysis', description: 'Extract concrete visual details from image' },
  { value: 'anti_cliche_filter', label: 'anti_cliche_filter', description: 'Reject predictable puns & stale tropes' },
  { value: 'twist_planner', label: 'twist_planner', description: 'Plan ironic human or engineering angle' },
  { value: 'caption_synthesis', label: 'caption_synthesis', description: 'Synthesize 5 ranked funny captions' },
  { value: 'system_persona', label: 'system_persona', description: 'Establish comedic voice & length rules' },
  { value: 'punchline_writer', label: 'punchline_writer', description: 'Draft crisp setup and final-word turn' },
  { value: 'custom_instruction', label: 'custom_instruction', description: 'Custom intermediate reasoning step' },
] as const;

export function escapePostgrestIlike(input: string): string {
  return input.replace(/([\\%_])/g, '\\$1');
}

export function slugifyChainName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

export function validateChainInput(body: Record<string, unknown>, partial = false) {
  const out: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 100) {
      throw new Error('Chain name must be between 2 and 100 characters.');
    }
    out.name = name;
  }

  if (!partial || body.slug !== undefined) {
    const rawSlug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const candidate = rawSlug || (typeof out.name === 'string' ? slugifyChainName(out.name) : '');
    if (!SLUG_RE.test(candidate)) {
      throw new Error('Chain slug must be 2-63 lowercase letters, digits, or hyphens.');
    }
    out.slug = candidate;
  }

  if (!partial || body.persona_style !== undefined) {
    const persona = typeof body.persona_style === 'string' ? body.persona_style.trim() : '';
    if (persona.length < 6 || persona.length > 1200) {
      throw new Error('System persona must be between 6 and 1,200 characters.');
    }
    out.persona_style = persona;
  }

  if (!partial || body.description !== undefined) {
    const desc = typeof body.description === 'string' ? body.description.trim() : '';
    if (desc.length > 600) {
      throw new Error('Description cannot exceed 600 characters.');
    }
    out.description = desc;
  }

  if (!partial || body.mix_weight !== undefined) {
    const weightNum = Number(body.mix_weight ?? 0);
    if (!Number.isFinite(weightNum) || weightNum < 0 || weightNum > 100) {
      throw new Error('Traffic weight must be an integer between 0 and 100.');
    }
    out.mix_weight = Math.round(weightNum);
  }

  if (!partial || body.is_active !== undefined) {
    out.is_active = body.is_active === undefined ? true : Boolean(body.is_active);
  }

  return out;
}

export function validateStepInput(body: Record<string, unknown>, partial = false) {
  const out: Record<string, unknown> = {};

  if (!partial || body.step_name !== undefined) {
    const stepName = typeof body.step_name === 'string' ? body.step_name.trim() : '';
    if (stepName.length < 2 || stepName.length > 100) {
      throw new Error('Step name must be between 2 and 100 characters.');
    }
    out.step_name = stepName;
  }

  if (!partial || body.step_role !== undefined) {
    const role = typeof body.step_role === 'string' ? body.step_role.trim() : 'custom_instruction';
    if (!/^[a-z0-9_]{2,48}$/.test(role)) {
      throw new Error('Step role must be 2-48 lowercase letters, digits, or underscores.');
    }
    out.step_role = role;
  }

  if (!partial || body.instruction_template !== undefined) {
    const tpl = typeof body.instruction_template === 'string' ? body.instruction_template.trim() : '';
    if (tpl.length < 6 || tpl.length > 2400) {
      throw new Error('Instruction template must be between 6 and 2,400 characters.');
    }
    out.instruction_template = tpl;
  }

  if (!partial || body.output_field !== undefined) {
    const rawField = typeof body.output_field === 'string' ? body.output_field.trim() : '';
    if (rawField.length > 80) {
      throw new Error('Output field label cannot exceed 80 characters.');
    }
    out.output_field = rawField || null;
  }

  return out;
}

export type TemplateSegment =
  | { type: 'text'; value: string }
  | { type: 'variable'; value: string };

export function tokenizeTemplateVariables(template: string): TemplateSegment[] {
  const re = /(\{\{\s*(?:input|prev_output|step_\d+_output)\s*\}\})/gi;
  const segments: TemplateSegment[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: template.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'variable', value: match[1] });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIdx) });
  }
  return segments;
}

export function compileStepInstruction(params: {
  personaStyle: string;
  stepOrder: number;
  totalSteps: number;
  stepName: string;
  stepRole: string;
  instructionTemplate: string;
  inputContext: string;
  upstreamOutputs: readonly string[];
}): string {
  const {
    personaStyle,
    stepOrder,
    totalSteps,
    stepName,
    stepRole,
    instructionTemplate,
    inputContext,
    upstreamOutputs,
  } = params;

  const prevOutput = upstreamOutputs.length > 0 ? upstreamOutputs[upstreamOutputs.length - 1] : '';
  const hasInputVar = /\{\{\s*input\s*\}\}/i.test(instructionTemplate);
  const hasPrevOrStepVar = /\{\{\s*(?:prev_output|step_\d+_output)\s*\}\}/i.test(instructionTemplate);

  // Single-pass variable interpolation prevents recursive re-expansion if upstream output contains {{...}}
  const interpolated = instructionTemplate.replace(
    /\{\{\s*(input|prev_output|step_(\d+)_output)\s*\}\}/gi,
    (_whole, token: string, stepNumRaw?: string) => {
      const lower = token.toLowerCase();
      if (lower === 'input') {
        return inputContext || '(No extra premise supplied; rely on the visual scene.)';
      }
      if (lower === 'prev_output') {
        return prevOutput || inputContext || '(None)';
      }
      if (stepNumRaw) {
        const idx = Number.parseInt(stepNumRaw, 10) - 1;
        if (idx >= 0 && idx < upstreamOutputs.length) {
          return upstreamOutputs[idx];
        }
      }
      return '';
    }
  );

  const lines: string[] = [
    personaStyle.trim() ||
      'You are a sharp comedy writer crafting concrete, original visual captions.',
    `Pipeline Stage ${stepOrder} of ${totalSteps} — ${stepName} (${stepRole}):`,
    interpolated,
  ];

  if (stepOrder === 1 && !hasInputVar && inputContext.trim()) {
    lines.push(`Scene / Premise Context ({{input}}):\n${inputContext.trim()}`);
  }

  if (stepOrder > 1 && !hasPrevOrStepVar && prevOutput.trim()) {
    lines.push(`Upstream Step Output ({{prev_output}}):\n${prevOutput.trim()}`);
  }

  if (stepOrder === totalSteps) {
    lines.push(
      'Final Output Contract: Return strictly a valid JSON object matching {"captions": ["...", "...", "...", "...", "..."]} with exactly 5 distinct, punchy funny captions (6-18 words each) and no markdown fences.'
    );
  } else {
    lines.push(
      'Intermediate Output Contract: Return concise, concrete prose (2-4 sentences) for the next step in the prompt chain, without writing the final 5 captions yet.'
    );
  }

  return lines.join('\n\n');
}

export function parseFiveCaptions(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('invalid_output');
  }

  let candidateJson = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!candidateJson.startsWith('{') && !candidateJson.startsWith('[')) {
    const objStart = candidateJson.indexOf('{');
    const objEnd = candidateJson.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      candidateJson = candidateJson.slice(objStart, objEnd + 1);
    }
  }

  try {
    const parsed = JSON.parse(candidateJson);
    const rawList = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.captions)
        ? parsed.captions
        : Array.isArray(parsed?.jokes)
          ? parsed.jokes
          : typeof parsed?.setup === 'string' && typeof parsed?.punchline === 'string'
            ? [`${parsed.setup.trim()} ${parsed.punchline.trim()}`.trim()]
            : null;

    if (rawList) {
      const cleaned = rawList
        .map((item: unknown) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            if (typeof rec.caption === 'string') return rec.caption.trim();
            if (typeof rec.text === 'string') return rec.text.trim();
            if (typeof rec.setup === 'string' && typeof rec.punchline === 'string') {
              return `${rec.setup.trim()} ${rec.punchline.trim()}`.trim();
            }
          }
          return '';
        })
        .filter((s: string) => s.length > 0)
        .slice(0, 5);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  } catch {
    // Fall back to numbered/bulleted line extraction when a non-JSON provider returns plain lines.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^```[a-z]*$/i, '')
        .replace(/^\s*(?:[-*•]|\d+[.)]|#\d+[:]?)\s*/, '')
        .replace(/^["“]|["”]$/g, '')
        .trim()
    )
    .filter((line) => line.length >= 6 && !line.startsWith('{') && !line.startsWith('}'));

  if (lines.length === 0) {
    throw new Error('invalid_output');
  }
  return lines.slice(0, 5);
}

export function normalizeRunStepOutputs(raw: unknown): StepExecutionTrace[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const stepOrder = Number(rec.step_order ?? rec.stepOrder ?? idx + 1);
    const latency = Number(rec.latency_ms ?? rec.latencyMs ?? 0);
    const inTok = rec.input_tokens ?? rec.inputTokens;
    const outTok = rec.output_tokens ?? rec.outputTokens;
    return {
      step_order: Number.isFinite(stepOrder) && stepOrder > 0 ? stepOrder : idx + 1,
      step_id: typeof (rec.step_id ?? rec.stepId) === 'string' ? String(rec.step_id ?? rec.stepId) : null,
      step_name: String(rec.step_name ?? rec.stepName ?? `Step ${idx + 1}`),
      step_role: String(rec.step_role ?? rec.stepRole ?? 'instruction'),
      output_field:
        typeof (rec.output_field ?? rec.outputField) === 'string' && String(rec.output_field ?? rec.outputField).trim()
          ? String(rec.output_field ?? rec.outputField).trim()
          : null,
      compiled_prompt: String(rec.compiled_prompt ?? rec.compiledPrompt ?? rec.prompt ?? ''),
      output_text: String(rec.output_text ?? rec.outputText ?? rec.output ?? ''),
      latency_ms: Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : 0,
      input_tokens: typeof inTok === 'number' && Number.isFinite(inTok) ? inTok : null,
      output_tokens: typeof outTok === 'number' && Number.isFinite(outTok) ? outTok : null,
    };
  });
}

export function normalizeFinalCaptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec.caption === 'string') return rec.caption.trim();
        if (typeof rec.text === 'string') return rec.text.trim();
        if (typeof rec.setup === 'string' && typeof rec.punchline === 'string') {
          return `${rec.setup.trim()} ${rec.punchline.trim()}`.trim();
        }
      }
      return '';
    })
    .filter(Boolean);
}

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

type Ipv6Hextets = [number, number, number, number, number, number, number, number];

function parseIpv6Hextets(raw: string): Ipv6Hextets | null {
  let clean = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean || clean.includes('%') || !/^[0-9a-f:.]+$/.test(clean)) {
    return null;
  }

  // Convert trailing embedded dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into two 16-bit hex groups
  if (clean.includes('.')) {
    const lastColon = clean.lastIndexOf(':');
    if (lastColon < 0) return null;
    const v4Part = clean.slice(lastColon + 1);
    const octets = parseIpv4Octets(v4Part);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    clean = `${clean.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = clean.split('::');
  if (doubleColonParts.length > 2) return null;

  let groups: string[];
  if (doubleColonParts.length === 2) {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  } else {
    groups = clean.split(':');
    if (groups.length !== 8) return null;
  }

  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    nums.push(Number.parseInt(g, 16));
  }
  return nums as Ipv6Hextets;
}

export function isPublicIpAddress(ipRaw: string): boolean {
  const clean = ipRaw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return false;

  const v4 = parseIpv4Octets(clean);
  if (v4) {
    return isPublicIpv4(v4);
  }

  if (!clean.includes(':')) {
    return false;
  }

  const h = parseIpv6Hextets(clean);
  if (!h) return false;

  // IPv4-mapped IPv6 ::ffff:0:0/96 (handles both ::ffff:127.0.0.1 and URL-normalized ::ffff:7f00:1)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPublicIpv4([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff]);
  }

  // Require IANA Global Unicast 2000::/3 (blocks ::/128, ::1/128, ::/96 IPv4-compatible,
  // 64:ff9b::/96 & 64:ff9b:1::/48 NAT64, 100::/64 discard, fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast)
  if ((h[0] & 0xe000) !== 0x2000) {
    return false;
  }

  // Special-purpose prefixes inside 2000::/3:
  // 2001:0000::/32 Teredo, 2001:0002:0000::/48 Benchmarking, 2001:0db8::/32 Documentation,
  // 2001:0010::/28 & 2001:0020::/28 ORCHID / ORCHIDv2
  if (h[0] === 0x2001) {
    if (h[1] === 0x0000) return false;
    if (h[1] === 0x0002 && h[2] === 0x0000) return false;
    if (h[1] === 0x0db8) return false;
    if ((h[1] & 0xfff0) === 0x0010 || (h[1] & 0xfff0) === 0x0020) return false;
  }

  // 2002::/16 6to4 embeds an IPv4 address in h[1..2]
  if (h[0] === 0x2002) {
    return isPublicIpv4([(h[1] >> 8) & 0xff, h[1] & 0xff, (h[2] >> 8) & 0xff, h[2] & 0xff]);
  }

  return true;
}

function isPublicIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

export function validateExternalImageUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new Error('Provide an https:// image URL (up to 2,048 characters).');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid image URL format.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('External image URLs must use https://.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Image URLs cannot embed credentials.');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('External image URLs must use standard HTTPS port 443.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    /^(?:0x[0-9a-f]+|\d+)$/i.test(host)
  ) {
    throw new Error('Private, loopback, or internal image hosts are not allowed.');
  }

  if (parseIpv4Octets(host) || host.includes(':')) {
    if (!isPublicIpAddress(host)) {
      throw new Error('Private or loopback IP addresses are not allowed.');
    }
  } else if (!host.includes('.')) {
    throw new Error('Image URL hostname must be a public domain.');
  }

  return parsed;
}

export function parseBoundedImageDataUrl(rawDataUrl: string): {
  mimeType: string;
  base64Data: string;
  dataUrl: string;
  byteLength: number;
} {
  const trimmed = rawDataUrl.trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error('Image data must be a base64-encoded PNG, JPEG, WebP, or GIF image.');
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_VISION_MIMES.has(mimeType)) {
    throw new Error(
      `Unsupported vision MIME type "${mimeType}". Use PNG, JPEG, WebP, or GIF (SVG scenes must be rasterized to PNG).`
    );
  }
  const base64Data = match[2].replace(/\s+/g, '');
  const buf = Buffer.from(base64Data, 'base64');
  if (buf.byteLength < 16) {
    throw new Error('Uploaded image payload is empty or corrupted.');
  }
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 4 MB maximum upload size.');
  }
  return {
    mimeType,
    base64Data: buf.toString('base64'),
    dataUrl: `data:${mimeType};base64,${buf.toString('base64')}`,
    byteLength: buf.byteLength,
  };
}
