import { streamGeminiChat, type GeminiContent } from './geminiClient';
import {
  formatItemIntakeForPrompt,
  type ItemIntakeProfile,
} from './intakeProfile';

interface GenerateMarketStrategyOptions {
  userRequest: string;
  profile: ItemIntakeProfile;
  researchReport: string;
  signal?: AbortSignal;
}

export async function generateMarketStrategy({
  userRequest,
  profile,
  researchReport,
  signal,
}: GenerateMarketStrategyOptions) {
  const systemInstruction = [
    'You are The Oracle Pricing + Listing Strategy Agent.',
    'All reasoning, prompt-writing, and structured output must be produced as a Gemini 3.5 Flash planning step.',
    'Use only the structured intake and browser-use research report provided.',
    'If a key fact is missing, label it as "needs verification" instead of inventing it.',
    'For ad creative, do not require the user\'s real face. Prefer a synthetic adult male presenter reference image in casual clothing unless the user explicitly uploads and approves a real likeness.',
    'Return concise markdown that the chat can show directly.',
  ].join('\n');

  const prompt = [
    'Create a resale strategy package for this user.',
    '',
    'User request:',
    userRequest,
    '',
    'Structured item intake JSON:',
    formatItemIntakeForPrompt(profile),
    '',
    'Browser-use market research report:',
    researchReport,
    '',
    'Output these sections in order:',
    '## Structured Inputs',
    '- Compact bullets for itemName, buildYear, model/build, specs, condition, target/floor price, fulfillment.',
    '## Pricing Strategy',
    '- Recommended list price, expected close price, floor guardrail, first 48-hour plan, negotiation script.',
    '## Marketplace Listing',
    '- Title, short description, included items, condition note, safety/payment note, and search keywords.',
    '## Synthetic Presenter Reference Image',
    '- A ready-to-use prompt for generating a clearly synthetic adult male presenter in casual clothing.',
    '- The person must not resemble a real public figure or the user. Keep it generic, friendly, and marketplace-safe.',
    '- Include wardrobe, pose, background, lighting, framing, and negative prompts.',
    '## TikTok/Veo Ad Brief',
    '- 8-second vertical ad concept, shot list, voiceover, captions, and a Veo prompt that uses the synthetic presenter reference image plus the product photo as ingredients/reference images.',
    '- State that the synthetic presenter is AI-generated and does not represent the seller.',
    '- If the user later wants their own face or likeness, state that it should only use an uploaded and explicitly approved user reference image.',
  ].join('\n');

  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }];
  let output = '';
  for await (const delta of streamGeminiChat(contents, {
    systemInstruction,
    temperature: 0.35,
    signal,
  })) {
    output += delta;
  }
  return output.trim();
}

export function buildResearchTask(userText: string, profile: ItemIntakeProfile) {
  const itemName = profile.itemName || profile.modelName || 'the item';
  const specs = [
    profile.buildYear,
    profile.modelName,
    profile.chip,
    profile.ramGb ? `${profile.ramGb}GB RAM` : null,
    profile.storageGb ? `${profile.storageGb}GB storage` : null,
    profile.screenSizeInches ? `${profile.screenSizeInches}" screen` : null,
    profile.condition,
  ].filter(Boolean);
  const floor = profile.floorPriceUsd ? `$${profile.floorPriceUsd}` : 'the seller floor';
  const ask = profile.desiredPriceUsd ? `$${profile.desiredPriceUsd}` : 'a defensible list price';
  const fulfillment = profile.shippingPreference || profile.pickupLocation || 'safe resale channels';

  return [
    userText.replace(/^\/research\s*/i, '').trim() ||
      `Research live resale channels and sold comps for ${itemName}.`,
    '',
    'Use this structured intake as the source of truth:',
    JSON.stringify(profile, null, 2),
    '',
    `Find real marketplace signals for ${itemName}${specs.length ? ` (${specs.join(', ')})` : ''}.`,
    `Compare channels for expected net payout, fees, sell-through time, buyer quality, and scam risk.`,
    `Recommend a pricing path that can target ${ask} while protecting ${floor}.`,
    `Account for fulfillment preference: ${fulfillment}.`,
    'Return sources/URLs, observed price ranges, rejected outliers, and a ranked recommendation.',
  ].join('\n');
}
