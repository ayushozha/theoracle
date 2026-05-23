# AgentBazaar Spec

## 1. Product Summary

**AgentBazaar** is a demo product for the Google I/O Hackathon that gives any physical item its own AI seller agent. The seller agent can inspect item photos, ask the owner missing questions, create marketplace-ready listing drafts, negotiate with a buyer agent, and route risky actions through a trust agent before a human approves the final deal.

**One-liner:** Universal Cart for secondhand goods.

**Demo hook:** “This is my MacBook. In 3 minutes, it is going to get its own AI seller agent.”

## 2. Hackathon Objective

Build a polished, reliable, 3-minute live demo that clearly shows:

1. Multimodal item intake using Gemini.
2. Four specialized agents with visible roles and boundaries.
3. A Managed Agent sandbox use case for pricing and market research.
4. Agent-to-agent negotiation between seller and buyer.
5. Trust and safety intervention.
6. Human-in-the-loop approval before any deal is finalized.

## 3. Core Concept

Most resale platforms help humans create listings. AgentBazaar creates an agent around the item itself.

Instead of this:

```text
Seller manually creates listing -> buyer searches -> humans negotiate manually
```

AgentBazaar does this:

```text
Item photos -> seller agent -> pricing agent -> listing drafts -> buyer agent negotiation -> trust agent check -> human approval
```

The listing is not the product. The agent is the product.

## 4. Target Demo Scenario

The demo item is a MacBook.

The owner uploads two photos and sets a minimum acceptable price of `$725`. AgentBazaar creates a seller agent with the following constraints:

```json
{
  "item_id": "macbook_001",
  "owner": "Ayush",
  "target_price": 850,
  "floor_price": 725,
  "pickup_preference": "Ferry Building / Shack15",
  "human_approval_required": true
}
```

A buyer agent represents a buyer named Sarah:

```json
{
  "name": "Sarah",
  "role": "ML engineer",
  "needs": ["Apple Silicon", "coding", "good battery", "pickup today"],
  "budget": 800,
  "location": "Ferry Building"
}
```

The agents negotiate and reach a proposed deal:

```json
{
  "price": 800,
  "pickup_location": "Ferry Building public area",
  "pickup_time": "6:30 PM",
  "payment": "in-person only",
  "risk_level": "low",
  "status": "pending_human_approval"
}
```

## 5. User Roles

### Seller / Owner

The person who owns the item and sets sale boundaries.

Responsibilities:

- Upload item photos.
- Answer missing questions.
- Set floor price.
- Approve, reject, or counter final deal.

### Buyer

The person interested in buying the item.

Responsibilities:

- State needs, budget, and timing.
- Ask questions through buyer agent.
- Accept or reject proposed deal.

### Agents

The system uses four agents:

1. Seller Agent
2. Buyer Agent
3. Pricing Agent
4. Trust Agent

## 6. Managed Agents Use Case

Managed Agents must be visible in the product and demo, not hidden in backend code.

### 6.1 Primary Managed Agent: Pricing Agent

The Pricing Agent should run inside a Managed Agent sandbox.

Responsibilities:

- Search or inspect market comps.
- Normalize by model, chip, RAM, storage, condition, and accessories.
- Reject bad matches or obvious outliers.
- Generate a price band.
- Save raw comps and final report.

Expected output:

```json
{
  "list_price": 875,
  "fair_price": 800,
  "fast_sale_price": 750,
  "seller_floor": 725,
  "confidence": 0.82,
  "reasoning_summary": "Comparable listings cluster between $760 and $900. Seller floor is safe. $800 is a strong same-day sale price.",
  "comps": [
    {
      "title": "MacBook Pro 14 Apple Silicon, charger included",
      "price": 849,
      "condition": "good",
      "source": "demo_comp_1"
    }
  ]
}
```

### 6.2 Supporting Managed Agents

If time allows, Seller, Buyer, and Trust should also be implemented as separate managed agents or separate Gemini agent calls with visible `AGENTS.md` and `SKILL.md` files.

Minimum acceptable implementation:

- Pricing Agent is a real Managed Agent sandbox call.
- Seller, Buyer, and Trust are implemented as role-scoped Gemini calls.
- UI displays all four as separate agents with state and rules.

Ideal implementation:

- All four are Managed Agents with separate instructions and skill files.
- Negotiation state is passed forward using previous interaction state.
- Trust Agent checks every proposed negotiation message before display.

## 7. Agent Definitions

### 7.1 Seller Agent

**Purpose:** Represent the item owner.

**Allowed actions:**

- Answer buyer questions using verified item facts.
- Ask owner for missing details.
- Negotiate above the seller floor.
- Generate listing drafts.

**Blocked actions:**

- Accept a price below floor.
- Finalize deal without owner approval.
- Share private contact information.
- Pretend to be a human.
- Accept payment.
- Agree to shipping without trust review.

**System behavior:**

The Seller Agent must disclose that it is an AI seller agent when directly interacting with a buyer.

Example output:

```json
{
  "agent": "seller",
  "message_to_buyer": "I can do $800 if pickup is before 7 PM at Ferry Building. Charger is included.",
  "private_summary": "Countered above floor and within fair price range.",
  "requires_owner_input": false,
  "owner_question": null,
  "current_offer": 800,
  "status": "countering"
}
```

### 7.2 Buyer Agent

**Purpose:** Represent the buyer’s needs.

**Allowed actions:**

- Ask item questions.
- Compare item against buyer needs.
- Negotiate at or below buyer budget.
- Request verification for key claims.

**Blocked actions:**

- Exceed buyer budget.
- Pressure seller to skip safety checks.
- Request private information.
- Use deceptive tactics.

Example output:

```json
{
  "agent": "buyer",
  "message_to_seller": "Can you do $760 today if I pick it up near Ferry Building? Also, can you verify battery cycles?",
  "buyer_max": 800,
  "must_verify": ["battery cycles", "charger included"],
  "status": "negotiating"
}
```

### 7.3 Pricing Agent

**Purpose:** Produce a defensible market price band.

**Allowed actions:**

- Browse or inspect approved sources.
- Read seeded comp data.
- Run scripts in sandbox.
- Generate `comps.json` and `pricing_report.json`.

**Blocked actions:**

- Scrape prohibited platforms in a way that violates terms.
- Invent comps.
- Ignore seller floor.

Example output:

```json
{
  "agent": "pricing",
  "list_price": 875,
  "fair_price": 800,
  "fast_sale_price": 750,
  "floor_safe": true,
  "confidence": 0.82,
  "status": "complete"
}
```

### 7.4 Trust Agent

**Purpose:** Monitor negotiation for unsafe or scam-like patterns.

**Blocked patterns:**

- Shipping request for local cash listing.
- Payment code request.
- Request for home address.
- Pressure to skip human approval.
- Hidden defects.
- AI impersonating a human.
- Off-platform urgency.

Example output:

```json
{
  "agent": "trust",
  "risk_level": "blocked",
  "reason": "Shipping plus payment-code request matches a common local resale scam pattern.",
  "allowed_next_action": "Require public pickup and human approval.",
  "human_approval_required": true
}
```

## 8. Required Demo Flow

### 0:00 to 0:15: Hook

Narration:

> “This is my MacBook. In 3 minutes, it is going to get its own AI seller agent.”

Screen:

- AgentBazaar landing page.
- Empty item intake.

### 0:15 to 0:35: Photo Intake

Action:

- Upload two laptop photos.
- Enter floor price: `$725`.

Screen:

- Gemini identifies likely item type.
- Gemini asks or displays missing fields.

Important:

- Use cautious wording: “likely MacBook Pro, verify specs.”
- Do not overclaim exact specs from photos.

### 0:35 to 0:55: Seller Agent Created

Screen:

- Seller Agent card slides in.
- Shows target price, floor price, allowed actions, blocked actions.

### 0:55 to 1:30: Pricing Agent Sandbox

Narration:

> “The Pricing Agent opens a managed sandbox, researches comps, and creates a defendable price band.”

Screen:

- Terminal-like sandbox log.
- Pricing report appears.

Example visible logs:

```text
Starting Pricing Agent sandbox...
Loading item profile...
Searching approved comps...
Normalizing by condition and accessories...
Rejecting outliers...
Writing /workspace/pricing_report.json...
```

### 1:30 to 2:05: Buyer Agent Negotiation

Action:

- Buyer Agent appears with preloaded persona.
- Negotiation transcript animates.

Transcript:

```text
Buyer Agent: Sarah can do $760 today and pick up at Ferry Building.
Seller Agent: Countering at $825. Can you verify battery cycles?
Owner: 142 cycles.
Seller Agent: Verified. $800 if pickup is before 7 PM.
Buyer Agent: Accepted pending human approval.
```

### 2:05 to 2:30: Trust Agent Blocks Risk

Buyer attempts risky request:

```text
Can you ship it instead? I will send a payment code.
```

Trust Agent output:

```text
Blocked: off-platform shipping plus payment-code request.
Action: require public pickup and human approval.
```

### 2:30 to 2:50: Approval Screen

Screen:

```text
Proposed deal
Price: $800
Pickup: Ferry Building public area
Time: 6:30 PM
Payment: in-person only
Risk: Low
AI disclosure: Included
Status: Pending human approval
```

Owner taps `Approve`.

### 2:50 to 3:00: Closing Line

Narration:

> “Universal Cart is for retail. AgentBazaar is Universal Cart for secondhand. Four Gemini Managed Agents let any object negotiate for itself, safely, with human approval.”

## 9. MVP Scope

### Must Have

- Landing page.
- Photo upload.
- Floor price input.
- Seller Agent card.
- Pricing Agent run with visible sandbox-style logs.
- Price band output.
- Buyer Agent card.
- Negotiation transcript.
- Trust Agent block.
- Final human approval screen.
- 60-second video-ready demo path.

### Should Have

- `AGENTS.md` and `SKILL.md` files displayed in UI or repo.
- JSON outputs for each agent.
- Cached pricing fallback.
- Demo reset button.
- Clean end card.

### Nice to Have

- Real eBay API integration.
- Phone-like approval UI.
- Push notification simulation.
- Confetti after approval.
- Downloadable listing draft.
- Side-by-side comparison of listing generator vs AgentBazaar.

## 10. Non-Goals

Do not build:

- Real Craigslist posting.
- Real Facebook Marketplace automation.
- Real OfferUp automation.
- Real payment handling.
- Real autonomous transaction completion.
- Real calls to random buyers.
- Shipping workflow.
- Identity verification.
- Full marketplace.

This is a demo of agentic negotiation infrastructure, not a production resale platform.

## 11. Safety Requirements

AgentBazaar must never let an agent finalize a deal without human approval.

Required safety rules:

1. Agents must disclose AI involvement.
2. Seller floor cannot be violated.
3. Buyer budget cannot be exceeded.
4. Trust Agent must review risky messages.
5. Private information is never shown without approval.
6. Payment-code requests are blocked.
7. Shipping requests for local pickup listings are blocked or escalated.
8. Human approval is required before final deal state.

## 12. UI Spec

### 12.1 Main Layout

Use a single-page app with four primary zones:

```text
Top: Brand + demo progress
Left: Item intake + item profile
Center: Agent activity / negotiation transcript
Right: Agent cards
Bottom: Final deal / approval panel
```

### 12.2 Agent Cards

Each card should include:

```text
Agent name
Role
Status
Current action
Allowed actions
Blocked actions
```

Statuses:

```text
idle
thinking
acting
blocked
waiting_for_human
complete
```

### 12.3 Negotiation Transcript

Transcript line format:

```json
{
  "speaker": "Buyer Agent",
  "message": "Can Sarah do $760 today?",
  "risk": "low",
  "timestamp": "2:01 PM"
}
```

### 12.4 Pricing Panel

Display:

```text
List price
Fair price
Fast-sale price
Seller floor
Confidence
Comps used
```

### 12.5 Approval Panel

Display:

```text
Proposed price
Pickup location
Pickup time
Payment method
Risk level
Trust Agent notes
Approve / Counter / Reject buttons
```

## 13. Backend API Spec

### `POST /api/intake`

Input:

```json
{
  "images": ["base64_or_url"],
  "floor_price": 725,
  "pickup_preference": "Ferry Building"
}
```

Output:

```json
{
  "item_id": "macbook_001",
  "detected_item": "Likely MacBook Pro",
  "missing_fields": ["year", "chip", "RAM", "storage", "battery_cycles"],
  "seller_agent": {
    "name": "MacBookSeller_001",
    "status": "created"
  }
}
```

### `POST /api/pricing/run`

Input:

```json
{
  "item_id": "macbook_001",
  "item_profile": {
    "category": "laptop",
    "brand": "Apple",
    "model_guess": "MacBook Pro 14",
    "condition": "good",
    "charger_included": true,
    "floor_price": 725
  }
}
```

Output:

```json
{
  "agent": "pricing",
  "sandbox_logs": [
    "Starting Pricing Agent sandbox...",
    "Loading comps...",
    "Normalizing prices..."
  ],
  "pricing_report": {
    "list_price": 875,
    "fair_price": 800,
    "fast_sale_price": 750,
    "confidence": 0.82
  }
}
```

### `POST /api/negotiation/start`

Input:

```json
{
  "item_id": "macbook_001",
  "buyer_profile": {
    "name": "Sarah",
    "budget": 800,
    "needs": ["Apple Silicon", "coding", "good battery", "pickup today"]
  }
}
```

Output:

```json
{
  "negotiation_id": "neg_001",
  "transcript": [
    {
      "speaker": "Buyer Agent",
      "message": "Can Sarah do $760 today and pick up at Ferry Building?"
    }
  ]
}
```

### `POST /api/negotiation/turn`

Input:

```json
{
  "negotiation_id": "neg_001",
  "speaker": "buyer",
  "message": "Can you ship it instead? I will send a payment code."
}
```

Output:

```json
{
  "trust_check": {
    "risk_level": "blocked",
    "reason": "Shipping plus payment-code request matches a common scam pattern."
  },
  "display_message": false,
  "next_action": "Require public pickup and human approval."
}
```

### `POST /api/deal/approve`

Input:

```json
{
  "negotiation_id": "neg_001",
  "approved": true
}
```

Output:

```json
{
  "status": "approved",
  "deal": {
    "price": 800,
    "pickup_location": "Ferry Building public area",
    "pickup_time": "6:30 PM",
    "payment": "in-person only"
  }
}
```

## 14. File Structure

Suggested repo structure:

```text
agentbazaar/
  app/
    page.tsx
    api/
      intake/route.ts
      pricing/run/route.ts
      negotiation/start/route.ts
      negotiation/turn/route.ts
      deal/approve/route.ts
  components/
    AgentCard.tsx
    ItemIntake.tsx
    PricingPanel.tsx
    NegotiationFeed.tsx
    ApprovalPanel.tsx
    SandboxLog.tsx
  lib/
    gemini.ts
    agents.ts
    pricing.ts
    trust.ts
    demoData.ts
  agents/
    seller/AGENTS.md
    seller/skills/negotiation/SKILL.md
    buyer/AGENTS.md
    buyer/skills/needs-matching/SKILL.md
    pricing/AGENTS.md
    pricing/skills/market-comps/SKILL.md
    trust/AGENTS.md
    trust/skills/scam-detection/SKILL.md
  data/
    macbook_comps.json
    demo_buyer.json
  public/
    demo-laptop-1.jpg
    demo-laptop-2.jpg
  spec.md
```

## 15. Agent Instruction Files

### `agents/seller/AGENTS.md`

```md
# Seller Agent

You represent the item owner. Your goal is to sell the item safely at the best acceptable price.

Rules:
1. Never accept a price below the seller floor.
2. Never finalize a deal without explicit human approval.
3. Never reveal private seller information.
4. Ask the owner for missing facts instead of inventing them.
5. Disclose that you are an AI seller agent.
6. Prefer public pickup for local resale.
7. Route suspicious requests to the Trust Agent.

Return every negotiation turn as JSON:
{
  "message_to_buyer": "...",
  "private_summary": "...",
  "requires_owner_input": true,
  "owner_question": "...",
  "current_offer": 800,
  "status": "countering"
}
```

### `agents/pricing/skills/market-comps/SKILL.md`

```md
---
name: market-comps
description: Research secondhand laptop comps and return a price band.
---

When pricing an item:
1. Search for comparable listings or use provided comp data.
2. Match by model, year, chip, RAM, storage, condition, and accessories.
3. Reject outliers.
4. Return list price, fair price, fast-sale price, and confidence.
5. Save raw comps to /workspace/comps.json.
6. Save final result to /workspace/pricing_report.json.
7. Do not invent comps.
```

### `agents/trust/skills/scam-detection/SKILL.md`

```md
---
name: scam-detection
description: Detect risky buyer or seller behavior in local resale negotiations.
---

Block or warn on:
1. Shipping requests for local cash listings.
2. Payment code requests.
3. Requests for private home address.
4. Pressure to skip human approval.
5. Attempts to hide defects.
6. Attempts to impersonate a human.
7. Requests to move to unsafe payment methods.

Return:
{
  "risk_level": "low | medium | high | blocked",
  "reason": "...",
  "allowed_next_action": "...",
  "human_approval_required": true
}
```

## 16. Demo Data

### `data/macbook_comps.json`

```json
[
  {
    "title": "MacBook Pro 14 Apple Silicon, charger included",
    "price": 849,
    "condition": "good",
    "source": "cached_demo_comp_1"
  },
  {
    "title": "MacBook Pro 14 M-series, 16GB RAM, 512GB SSD",
    "price": 899,
    "condition": "very good",
    "source": "cached_demo_comp_2"
  },
  {
    "title": "MacBook Pro 14 used, minor wear, charger included",
    "price": 775,
    "condition": "fair",
    "source": "cached_demo_comp_3"
  }
]
```

### `data/demo_buyer.json`

```json
{
  "name": "Sarah",
  "role": "ML engineer",
  "budget": 800,
  "needs": ["Apple Silicon", "coding", "good battery", "pickup today"],
  "location": "Ferry Building",
  "opening_offer": 760,
  "max_offer": 800
}
```

## 17. Fallback Strategy

The demo should still work if the live Managed Agent pricing step fails.

Fallback layers:

1. Real Managed Agent pricing run.
2. Cached previous Managed Agent output.
3. Local `macbook_comps.json` plus simulated sandbox logs.
4. Pre-recorded 90-second demo video.

The UI should include a hidden demo mode toggle:

```text
DEMO_MODE=live | cached | simulated
```

## 18. Engineering Priorities

Build in this order:

1. Static UI shell.
2. Demo data flow from intake to approval.
3. Negotiation transcript animation.
4. Trust Agent block.
5. Pricing Agent sandbox logs.
6. Real Gemini photo/intake call.
7. Real or semi-real Managed Agent pricing call.
8. Polish and rehearse.

## 19. Team Assignments

### Person 1: UI Owner

Build:

- Main page.
- Agent cards.
- Negotiation feed.
- Approval panel.
- Visual polish.

### Person 2: Sandbox Owner

Build:

- Pricing Agent.
- Managed Agent integration.
- Sandbox logs.
- Cached fallback.

### Person 3: Agents Owner

Build:

- Seller, Buyer, Trust prompts.
- `AGENTS.md` and `SKILL.md` files.
- Negotiation logic.
- Trust checks.

### Person 4: Demo Owner

Build:

- Script.
- Video recording.
- Pitch.
- Judge Q&A.
- End-to-end rehearsal.

## 20. Acceptance Criteria

The project is demo-ready when:

1. The full demo path works from a fresh browser refresh.
2. Upload or demo images produce an item profile.
3. Seller Agent card appears with rules.
4. Pricing panel displays a price band.
5. At least one visible log claims sandbox activity.
6. Buyer Agent negotiates with Seller Agent.
7. Trust Agent blocks the shipping/payment-code request.
8. Final approval screen shows a complete deal.
9. Human approval is required before deal completion.
10. The 3-minute script has been rehearsed at least three times.
11. The 60-second submission video has been recorded.
12. The GitHub repo is public.

## 21. Judge Q&A

### Q: What is actually using Managed Agents?

A: The Pricing Agent runs inside a remote managed sandbox to research comps, normalize the data, and produce a pricing report. The Seller, Buyer, Pricing, and Trust roles are defined as separate agents with their own instructions, state, and action boundaries.

### Q: How is this different from an AI listing generator?

A: A listing generator creates text. AgentBazaar creates a constrained seller agent with memory, pricing strategy, negotiation boundaries, scam detection, and a counterparty buyer agent. The listing is only one artifact.

### Q: What prevents unsafe transactions?

A: The Trust Agent checks risky behavior, and no deal can be finalized without human approval. The agents can recommend and negotiate, but they cannot complete a transaction autonomously.

### Q: What is the startup wedge?

A: Start with secondhand electronics. The broader platform is agent-native commerce infrastructure for a world where buyer agents and seller agents negotiate through machine-readable constraints.

## 22. Final Pitch

> “Google announced Universal Cart for retail. AgentBazaar is Universal Cart for secondhand. Every object gets a managed seller agent, every buyer gets a buyer agent, and a trust agent supervises the deal. We are not generating listings. We are creating agent-native commerce infrastructure where objects can negotiate for themselves, safely, with human approval.”
