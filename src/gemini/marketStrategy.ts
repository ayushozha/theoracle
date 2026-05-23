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
    'Use only the structured intake and browser-use research report provided.',
    'If a key fact is missing, label it as "needs verification" instead of inventing it.',
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
    '## TikTok/Veo Ad Brief',
    '- 8-second vertical ad concept, shot list, voiceover, captions, and a Veo prompt.',
    '- If a real face or likeness is needed, state that it should only use an uploaded/approved user reference image.',
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
