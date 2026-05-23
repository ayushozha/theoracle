// Runtime helper for the Marketplace Research Agent.
//
// Streams a live Gemini Deep Research-style response using the agent's
// declarative descriptor (research-agent.json) as the system prompt source
// of truth. Honors the per-agent `model` field so the descriptor stays the
// single source of model selection for this agent.

import researchAgent from './research-agent.json';
import { streamGeminiChat, type GeminiContent } from '../gemini/geminiClient';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

/**
 * Compose the deep-research system instruction by combining the agent's
 * system_prompt with its research_plan and item/seller context. This way
 * the live call mirrors what the descriptor card promises in the UI.
 */
function buildSystemInstruction(): string {
  const plan = researchAgent.research_plan.map((line) => `  ${line}`).join('\n');
  const ctx = JSON.stringify(researchAgent.context, null, 2);
  const blocked = researchAgent.blocked_actions.map((a) => `  - ${a}`).join('\n');

  return [
    researchAgent.system_prompt,
    '',
    'Research plan you must follow:',
    plan,
    '',
    'Item + seller context:',
    ctx,
    '',
    'Hard constraints (refuse to violate):',
    blocked,
    '',
    'Output format: markdown, with these sections in this order:',
    '  1. "Research goal" — one sentence restating the question.',
    '  2. "Research plan" — your numbered plan (may refine the one above).',
    '  3. "Channel survey" — one short paragraph per candidate channel.',
    '  4. "Scorecard table" — channel | net payout | days to sell | fees | composite (markdown table).',
    '  5. "Top recommendation" — channel name + one-paragraph rationale tied to the floor price and pickup constraint.',
    '  6. "Publish order" — ranked list.',
  ].join('\n');
}

export interface RunResearchOptions {
  /** Optional user question — defaults to the agent's built-in MacBook goal. */
  query?: string;
  signal?: AbortSignal;
}

/**
 * Stream a live deep-research response. Yields markdown deltas.
 *
 * Uses the browser → Gemini REST API path (apiKey mode) because this Vite
 * project has no backend. The descriptor's `model` field is the source of
 * truth — bump research-agent.json `model` to change which Gemini revision
 * answers.
 */
export async function* runResearchAgent(
  opts: RunResearchOptions = {},
): AsyncGenerator<string, void, void> {
  if (!API_KEY) {
    throw new Error(
      'VITE_GEMINI_API_KEY is not set. Add it to .env to run the Research Agent live.',
    );
  }

  const userQuestion =
    opts.query?.trim() ||
    `Where should I list my ${researchAgent.context.item_profile.product_class} (${researchAgent.context.item_profile.chip}, ${researchAgent.context.item_profile.ram_gb}GB / ${researchAgent.context.item_profile.storage_gb}GB, ${researchAgent.context.item_profile.condition}) to clear above $${researchAgent.context.seller_constraints.floor_price} within 7 days, local pickup only?`;

  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: userQuestion }] },
  ];

  yield* streamGeminiChat(contents, {
    model: researchAgent.model,
    apiKey: API_KEY,
    systemInstruction: buildSystemInstruction(),
    temperature: 0.4,
    signal: opts.signal,
  });
}
