import {
  fileToInlinePart,
  streamGeminiChat,
  type GeminiContent,
  type GeminiPart,
} from './geminiClient';

export interface ItemIntakeProfile {
  itemName: string | null;
  productCategory: string | null;
  brand: string | null;
  modelName: string | null;
  buildYear: string | null;
  chip: string | null;
  ramGb: number | null;
  storageGb: number | null;
  screenSizeInches: number | null;
  color: string | null;
  condition: string | null;
  scratches: string | null;
  dents: string | null;
  repairs: string | null;
  batteryCycleCount: number | null;
  batteryHealthPercent: number | null;
  includedAccessories: string[];
  warrantyOrAppleCare: string | null;
  desiredPriceUsd: number | null;
  floorPriceUsd: number | null;
  pickupLocation: string | null;
  shippingPreference: string | null;
  urgency: string | null;
  missingFields: string[];
  confidence: number;
  sourceSummary: string;
}

const EMPTY_PROFILE: ItemIntakeProfile = {
  itemName: null,
  productCategory: null,
  brand: null,
  modelName: null,
  buildYear: null,
  chip: null,
  ramGb: null,
  storageGb: null,
  screenSizeInches: null,
  color: null,
  condition: null,
  scratches: null,
  dents: null,
  repairs: null,
  batteryCycleCount: null,
  batteryHealthPercent: null,
  includedAccessories: [],
  warrantyOrAppleCare: null,
  desiredPriceUsd: null,
  floorPriceUsd: null,
  pickupLocation: null,
  shippingPreference: null,
  urgency: null,
  missingFields: [],
  confidence: 0,
  sourceSummary: '',
};

export function createEmptyItemIntakeProfile(): ItemIntakeProfile {
  return { ...EMPTY_PROFILE, includedAccessories: [], missingFields: [] };
}

export function mergeItemIntakeProfile(
  previous: ItemIntakeProfile,
  next: Partial<ItemIntakeProfile>,
): ItemIntakeProfile {
  const merged: ItemIntakeProfile = { ...previous };

  for (const key of Object.keys(EMPTY_PROFILE) as (keyof ItemIntakeProfile)[]) {
    const value = next[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) {
        const current = Array.isArray(merged[key]) ? (merged[key] as string[]) : [];
        merged[key] = Array.from(new Set([...current, ...value])) as never;
      }
      continue;
    }
    merged[key] = value as never;
  }

  merged.confidence = Math.max(previous.confidence ?? 0, next.confidence ?? 0);
  if (next.missingFields) merged.missingFields = next.missingFields;
  if (next.sourceSummary) merged.sourceSummary = next.sourceSummary;
  return merged;
}

export function hasUsefulIntake(profile: ItemIntakeProfile) {
  return Boolean(
    profile.itemName ||
      profile.modelName ||
      profile.chip ||
      profile.ramGb ||
      profile.storageGb ||
      profile.desiredPriceUsd ||
      profile.floorPriceUsd,
  );
}

export function formatItemIntakeForPrompt(profile: ItemIntakeProfile) {
  return JSON.stringify(profile, null, 2);
}

export function profileDisplayFields(profile: ItemIntakeProfile) {
  return [
    ['Item', profile.itemName],
    ['Year', profile.buildYear],
    ['Model', profile.modelName],
    ['Chip', profile.chip],
    ['RAM', profile.ramGb ? `${profile.ramGb}GB` : null],
    ['Storage', profile.storageGb ? `${profile.storageGb}GB` : null],
    ['Condition', profile.condition],
    ['Battery', profile.batteryCycleCount ? `${profile.batteryCycleCount} cycles` : null],
    ['Ask', profile.desiredPriceUsd ? `$${profile.desiredPriceUsd}` : null],
    ['Floor', profile.floorPriceUsd ? `$${profile.floorPriceUsd}` : null],
    ['Fulfillment', profile.shippingPreference || profile.pickupLocation],
  ].filter(([, value]) => Boolean(value)) as [string, string][];
}

export interface ExtractIntakeOptions {
  userText: string;
  files?: { file: File }[];
  previousProfile: ItemIntakeProfile;
  recentContext?: string;
  signal?: AbortSignal;
}

export async function extractItemIntakeProfile({
  userText,
  files = [],
  previousProfile,
  recentContext,
  signal,
}: ExtractIntakeOptions): Promise<ItemIntakeProfile> {
  const systemInstruction = [
    'You are the intake normalizer for The Oracle resale agents.',
    'Extract only information that is stated by the user or visible in attached images.',
    'Use Gemini vision for any attached image before filling product fields.',
    'Be cautious: if a field is uncertain, use null and add it to missingFields.',
    'Return strict JSON only. No markdown, no commentary.',
  ].join('\n');

  const parts: GeminiPart[] = [
    {
      text: [
        'Normalize the latest user turn into this exact JSON schema:',
        JSON.stringify(EMPTY_PROFILE, null, 2),
        '',
        'Previous structured profile:',
        formatItemIntakeForPrompt(previousProfile),
        '',
        recentContext ? `Recent conversation:\n${recentContext}\n` : '',
        'Latest user turn:',
        userText.trim() || '(No text; rely on attachments if present.)',
      ].join('\n'),
    },
  ];

  for (const attachment of files) {
    parts.push(await fileToInlinePart(attachment.file));
  }

  const contents: GeminiContent[] = [{ role: 'user', parts }];
  let raw = '';
  for await (const delta of streamGeminiChat(contents, {
    systemInstruction,
    temperature: 0,
    signal,
  })) {
    raw += delta;
  }

  return mergeItemIntakeProfile(previousProfile, parseProfileJson(raw));
}

function parseProfileJson(raw: string): Partial<ItemIntakeProfile> {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(clean) as Partial<ItemIntakeProfile>;
    return {
      ...parsed,
      includedAccessories: normalizeStringArray(parsed.includedAccessories),
      missingFields: normalizeStringArray(parsed.missingFields),
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0,
    };
  } catch {
    return {
      missingFields: ['exact model/year', 'RAM', 'storage', 'condition', 'target price'],
      confidence: 0,
      sourceSummary: 'Could not parse structured intake from the latest turn.',
    };
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
