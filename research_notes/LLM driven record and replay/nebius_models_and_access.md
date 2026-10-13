# Nebius x NVIDIA Global AI Hackathon: LLM API access, credits, and model choice for a record-and-replay desktop agent

Snapshot date: 2026-10-07. The model catalog and prices come from the public Token Factory catalog API on that date. The catalog changes often (removal waves in June and August 2026), so re-check before relying on a model ID.

Activation and promo codes are deliberately left out. The notes only say where to get them.

---

## 1. Hackathon credits: how much, from which product, how to claim, and the model rules

### Takeaway
The official pages offer **two separate $25 Token Factory credit grants**, not one:
- **(a) Hackathon grant:** a Nebius promo form, using an activation code shown on the Devpost Resources tab.
- **(b) Builders Program grant:** joining the free Nebius Builders Program.

Both are **Token Factory credits only**; the Devpost FAQ says there is no separate published AI Cloud credit grant. Separately, every new Token Factory account gets $1 of trial credit (30 days), and onboarding requires a bank card.

The rules require the project to make a runtime call to Token Factory, or to run on Nebius AI Cloud compute, and to use at least one NVIDIA open-source model. The pages steer builders toward Nemotron ("Ultra for serious reasoning; Nano or Super for fast, everyday calls").

The submission deadline is **30 Oct 2026, 10:00 PT**, not around 22 October. Judging runs 1–15 Dec 2026.

### Cited Findings

**Credits: the amounts and where they come from**
- Resources tab, verbatim: "Fill out this form for $25 Token Factory credits." The next line tells entrants to enter a specific activation code; it is shown on that tab and not copied here. — [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources)
- Resources tab, verbatim: "Get another $25 Token Factory credits by joining the Nebius Builders Program for free credits (Token Factory, Tavily, Nebius Academy) plus office hours." — [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources)
- The "Fill out this form" link points to Nebius's promo-code form at nebius.com/promo-code.
  - The link pre-fills the event, product type and activation code as URL parameters; this note does not reproduce them.
  - The form asks for First name, Last name, Email and Company, and offers a choice between "Nebius AI Cloud" and "Nebius Token Factory".
  - Sources: [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources); [Nebius promo-code form](https://nebius.com/promo-code)
- Devpost FAQ, verbatim: "On credits: the official promotional credits (direct-credits-form code [...], and the Nebius Builders Program) are Token Factory credits specifically; there isn't a separate published AI Cloud credit grant." — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- Builders Program FAQ, verbatim: "You'll receive $25 in Nebius Token Factory credits, $100 in LangSmith credit from LangChain, $50 in Toloka and $50 in Tandem credit, and $25 in Tavily credit as well as access to a Nebius Academy certification for $1." — [Nebius Builders Program](https://dev.nebius.com/builders)
  - The same page's credit cards list "$25 Token Factory credit", "$25 Tavily credit", "$100 LangSmith credit", "Nebius certification for $1" and "$100 Toloka credit".
  - So the page contradicts itself on Toloka ($100 on the card, $50 plus $50 Tandem in the FAQ). The $25 Token Factory figure is consistent in both places. — [Nebius Builders Program](https://dev.nebius.com/builders)
- Builders Program steps:
  1. "Join: Sign up free and tell us what you're building."
  2. "Claim credits: Verify your email and claim credits for the tools you want to use."
  3. Build.
  4. "Scale up: Unlock benefits, distribution opportunities, and additional credits as your project grows."
  - It also says: "Partner offers are subject to eligibility, availability, and individual partner terms." — [Nebius Builders Program](https://dev.nebius.com/builders)
- Builders Program eligibility, verbatim: "Developers, researchers, students, founders, ML engineers, MLOps and platform engineers, open-source builders, and technical teams building with open AI technologies"; "The program is free to join for everyone"; "The Builder Program is primarily intended for learning, testing, and experimentation." — [Nebius Builders Program](https://dev.nebius.com/builders)
- In-person "Builders & Brews: Hack Edition" meetups (co-hosted by Nebius and Tavily) let attendees "unlock additional Nebius AI Cloud, Token Factory, Tavily credits to keep building after the event." — [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources)
- Trial credit and billing, verbatim:
  - "Billing setup is mandatory—you cannot complete onboarding without it."
  - "Setting up a billing account requires a bank card."
  - "Upon first sign-up, you receive $1 in trial credit, valid for 30 days."
  - Source: [Token Factory Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
- Auto-charge, verbatim: the card is charged automatically "At the start of the month, if your balance is negative" or "When the configured billing threshold is reached", and "If a card charge fails, your account is suspended." — [Token Factory Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
- Promo codes, verbatim: "A promo code provides free Nebius Token Factory credits... Promo codes usually have an expiration date—make sure to apply them before they expire." Apply via: balance → **Top up** → **With promo code** → enter code → **Top up**, then check **Transactions**. — [Token Factory Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
- Country restrictions: "A number of countries aren't yet supported in Nebius's billing/country-of-residence list for Token Factory onboarding." Missing credits or missing countries are "Being handled case by case with Nebius" via the Nebius Discord. — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)

**Dates**
- Submission Period: "Wednesday, August 26, 2026 (9:00 am Pacific Time) – Friday, October 30, 2026 (10:00 am Pacific Time)". Judging Period: "Tuesday, December 1, 2026 (9:00 am Pacific Time) – Tuesday, December 15, 2026 (12:00 pm Pacific Time)". — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- The overview page also shows "Deadline: Oct 30, 2026 @ 10:00am PDT". — [Devpost overview](https://nebiusglobalaihackathon.devpost.com/)

**Rules on platform and model use**
- Rules, verbatim: "Entrants must create a working software application that runs on either Nebius Token Factory or Nebius AI Cloud and uses at least one NVIDIA open source model..." — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- Rules, verbatim: "'Runs on Nebius Token Factory or Nebius AI Cloud' means the project makes a runtime call to the Token Factory inference API, or is deployed/run using Nebius AI Cloud compute (Serverless Jobs, Serverless Endpoints, or DevPods)." — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- FAQ: calling an NVIDIA model through Token Factory satisfies the requirement, and "the rest of your app (web frontend, unrelated backend processing) doesn't also need to be hosted on Nebius AI Cloud." — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- FAQ, verbatim: "Can I call an NVIDIA model through a different provider (e.g. HuggingFace / OpenRouter) instead of Nebius? No ... there's no approved workaround for that piece." This rules out build.nvidia.com and other hosts as the only NVIDIA path. — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- The hackathon's own model guidance:
  - Best Apps and Agents track: "Power it with Nemotron models on Nebius through Token Factory. Reach for Nemotron 3 Ultra when you need serious reasoning, and let Nano or Super handle the fast, everyday calls, so your app stays responsive and your credits stretch further."
  - Personal AI track: "Use at least one NVIDIA open source model, and use tools such as NVIDIA NemoClaw, OpenShell, Hermes Agent, and Nebius Serverless."
  - Physical AI track: "Nemotron, GROOT, Cosmos and Sonic models."
  - Source: [Devpost overview](https://nebiusglobalaihackathon.devpost.com/)
- Updates page: "at least one NVIDIA open source model (Nemotron, GR00T, Cosmos, or Sonic)". The FAQ also allows NVIDIA Alpamayo and "other NVIDIA open models" for Physical AI. — [Devpost Updates](https://nebiusglobalaihackathon.devpost.com/updates); [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- Judging, verbatim: "How well is the project built, and how effectively does it use Nebius Token Factory or AI Cloud model(s), and NVIDIA Nemotron as part of the solution?" There are four equally weighted criteria: Technological Implementation, Design, Potential Impact, Quality of the Idea. — [Devpost overview](https://nebiusglobalaihackathon.devpost.com/); [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- Submission requirements:
  - A public video of 3 minutes or less showing "how you used Nebius Token Factory and NVIDIA Nemotron or other NVIDIA open source models".
  - A public open-source code repo with a README.
  - Feedback on Token Factory, AI Cloud and the NVIDIA models used.
  - Sources: [Devpost overview](https://nebiusglobalaihackathon.devpost.com/); [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- Rules, verbatim: "Access must be provided to an Entrant's working Project for judging and testing by providing a link to a website, functioning demo, or a test build ... The Entrant must make the Project available free of charge and without any restriction, for testing, evaluation and use by the Sponsor, Administrator ...". The quote is cut where the extracted text was cut; the rest of the sentence was not read. — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)

**Step-by-step claim and setup**

Each step is sourced; the order is inferred from the sources.
1. Register for the hackathon on Devpost ("Join hackathon"). — [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources)
2. Create a Token Factory account at tokenfactory.nebius.com. You can "Log in using your Google or GitHub account". — [Token Factory Quickstart](https://docs.tokenfactory.nebius.com/quickstart)
3. Finish onboarding: add a billing account with a bank card (mandatory). You receive $1 trial credit. — [Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
4. Hackathon $25:
   - Open "Fill out this form" on the Devpost Resources tab, which goes to nebius.com/promo-code.
   - Enter your name, email and company, choose Token Factory, and enter the activation code shown on the Resources tab.
   - Sources: [Devpost Resources](https://nebiusglobalaihackathon.devpost.com/resources); [promo form](https://nebius.com/promo-code)
5. Builders $25: join at dev.nebius.com/builders, verify your email and claim the credits. — [Builders Program](https://dev.nebius.com/builders)
6. Apply any promo code you receive: balance → Top up → With promo code. Confirm it under Transactions. — [Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
7. Create an API key: Project → [API keys](https://tokenfactory.nebius.com/project/api-keys) → Create API key → name it → Create → save it, because "You cannot open it later". — [API reference: Authentication](https://docs.tokenfactory.nebius.com/api-reference/introduction)
8. If credits don't arrive or your country is missing, ask on the Nebius Discord, which is linked from the Resources tab. — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)

### Inferences
- **The user's belief ("$25 from one source only") does not match the official pages.** The Resources tab says "Get *another* $25" through the Builders Program, so a team can probably get **$50 of Token Factory credit per account**, plus the $1 trial. In-person Builders & Brews events can add more, including AI Cloud credit.
  - Whether both $25 grants can go on the same account is not stated outright. The "another" wording implies they can.
  - The user's "one source" view may come from the FAQ line saying there is no separate *AI Cloud* grant. That is true, but it is a different point.
- **The $25 does not apply to AI Cloud.** Running GPU VMs or self-hosting a model on AI Cloud would be billed to the card.
- **Auto-charge risk:** the bank card is auto-charged when the balance goes negative. A runaway loop, a leaked key or heavy judge traffic would bill the card once the credits run out. Use a proxy-side budget cap (Section 3).
- **The deadline is 30 Oct, not about 22 Oct.** The project must stay testable through judging (1–15 Dec), so the API key, proxy and credit balance must last into mid-December.
  - Promo codes "usually have an expiration date". Apply them as soon as they arrive, and check whether the credited balance itself expires.
- The product is a personal record-and-replay agent, which fits **Personal AI** or **Best Apps and Agents**. Both tracks name Nemotron explicitly, and judging asks "how effectively" Nemotron is used. So Nemotron should be on the critical path (compile, replay decisions), not a token add-on.

### Gaps
- How the promo credit arrives after the nebius.com/promo-code form (by email, or applied straight to the account) is not documented on any page fetched.
- No expiry date was found for either $25 grant, or for credits once applied.
- No page states whether one person or team can claim both $25 grants on one Token Factory account. "Get another $25" implies yes.
- No eligibility limit (one per person, team or account) is published for either grant.
- The "about 22 October" date the user remembers appears on no official page fetched. It may be a city event or an internal team deadline; unconfirmed.

---

## 2. Token Factory vs AI Cloud: what each is, which serves hosted model APIs, and where the $25 applies

### Takeaway
**Token Factory** is the managed, per-token inference API for open models: OpenAI-compatible, serverless or dedicated endpoints. It is the product that serves hosted model APIs, and it is what both $25 grants pay for.

**AI Cloud** is GPU infrastructure: VMs, clusters, and Serverless Jobs/Endpoints/DevPods. It is for running your own stack. No hackathon AI Cloud credit is published.

### Cited Findings
- Token Factory, verbatim: "Serve open-source models via an OpenAI-compatible API with real-time and batch inference, dedicated endpoints, and production SLAs." — [Nebius for AI Builders](https://dev.nebius.com/)
- AI Cloud, verbatim: "Spin up GPU VMs and multi-node clusters for training and custom stacks, with full control." — [Nebius for AI Builders](https://dev.nebius.com/)
- The rules count AI Cloud as "Nebius AI Cloud compute (Serverless Jobs, Serverless Endpoints, or DevPods)". — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- Both official promo grants are Token Factory credits; "there isn't a separate published AI Cloud credit grant". — [Devpost FAQs](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- Token Factory has two endpoint types:
  - Public serverless endpoints are billed "Per token" with "Dynamic rate limits".
  - Dedicated endpoints are billed "Per GPU/hour, billed with per-minute granularity". They support custom weights "for eligible models", and their deployment region is fixed. — [Dedicated Endpoints overview](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/overview)
- "Working with custom model weights is currently in beta and available on request" (via Support). — [Custom model weights](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/custom-weights)
- Public serverless endpoints show Region "Global". The processing location "can change at any time, without notice". A region-specific base URL (e.g. `api.tokenfactory.us-central1.nebius.com`) "can stop working if the endpoint's processing region changes". Public endpoints "are best suited for testing and non-critical workloads". — [Public Serverless Endpoints](https://docs.tokenfactory.nebius.com/public-serverless)
- Resource model: Organization → Projects → Resources. API keys live inside a project, and "a default project is created automatically". — [Organizations and Projects](https://docs.tokenfactory.nebius.com/team-access/org-projects)

### Inferences
- For this product, **Token Factory serverless is the right and sufficient platform**. One HTTPS call per LLM step satisfies the "runs on Nebius" rule, and the desktop app and any proxy can live anywhere.
- AI Cloud or dedicated endpoints only matter for a model that isn't on serverless, such as an NVIDIA vision model (Section 4).
  - That compute is billed per GPU-hour, not covered by the $25, and must stay up through judging.
  - It is a poor trade for a hackathon budget.

### Gaps
- GPU-hour prices for dedicated endpoints and AI Cloud were not collected; they were out of scope given the credit structure.
- Which NVIDIA models are allowed as dedicated-endpoint templates was not checked. The template list API needs authentication.

---

## 3. How to call the API, authentication, rate limits, and how a desktop product should hold the key

### Takeaway
The API is OpenAI-compatible at **`https://api.tokenfactory.nebius.com/v1/`** with **Bearer API-key authentication only**. The docs mention no OAuth for inference.

Rate limits are dynamic per user: a default cap, auto-scaling in 15-minute windows, HTTP 429 with `x-ratelimit-*` and `Retry-After` headers.

The docs explicitly say not to expose keys in client-side code, and a desktop binary is client-side. So:
- Use a gitignored `.env` for development.
- Use a small proxy holding the key for the demo and judges, with per-install quotas and a budget kill-switch. No per-key spend cap is documented.

### Cited Findings
- Base URL `https://api.tokenfactory.nebius.com/v1/`. The docs' environment variable is `NEBIUS_API_KEY`. The Python example uses `OpenAI(base_url="https://api.tokenfactory.nebius.com/v1/", api_key=os.environ.get("NEBIUS_API_KEY"))`. — [Quickstart](https://docs.tokenfactory.nebius.com/quickstart); [API reference intro](https://docs.tokenfactory.nebius.com/api-reference/introduction)
- Example cURL from the docs. The model name there is the docs' own example; use a current ID from Section 4.
  ```
  curl 'https://api.tokenfactory.nebius.com/v1/chat/completions' \
    -X 'POST' -H 'Content-Type: application/json' -H 'Accept: */*' \
    -H "Authorization: Bearer $NEBIUS_API_KEY" \
    --data-binary '{"temperature":0.6,"model":"meta-llama/Meta-Llama-3.1-70B-Instruct","messages":[{"role":"user","content":"Hello!"}]}'
  ```
  — [API reference intro](https://docs.tokenfactory.nebius.com/api-reference/introduction). Note: `meta-llama/Meta-Llama-3.1-70B-Instruct` is not in the current public catalog, so the docs example is stale. — [models_info](https://tokenfactory.nebius.com/api/public/models_info)
- Authentication, verbatim: "To authenticate, include your API key ... in the Authorization header ... `Authorization: Bearer ABC123...`" — [API reference: Authentication](https://docs.tokenfactory.nebius.com/api-reference/introduction)
- Warning, verbatim: "Keep your keys private; do not share or expose them in client-side code. If a key is compromised, Nebius Token Factory can automatically revoke it." — [API reference: Authentication](https://docs.tokenfactory.nebius.com/api-reference/introduction)
- The only auth mechanism documented for inference is the Bearer API key. "Configure Single Sign-On" in the docs index is under Team Management (console access), not inference OAuth. — [Docs index (llms.txt)](https://docs.tokenfactory.nebius.com/llms.txt)
- Listing models: `GET https://api.tokenfactory.nebius.com/v1/models` (with the Bearer key). With `?verbose=true` the response adds `context_length`, `architecture.modality` (e.g. `"text->text"`), `pricing.prompt`, `pricing.completion`, `pricing.image`, and `per_request_limits` (`tokens_per_minute`, `requests_per_minute`). — [List of models](https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models)
- Unauthenticated `GET /v1/models` returns 401 "token is not present". A public, no-auth catalog exists at `https://tokenfactory.nebius.com/api/public/models_info`, described as "the authoritative machine-readable source" for models and pricing. — [model-catalog.md](https://tokenfactory.nebius.com/model-catalog.md); [Token Factory llms.txt](https://tokenfactory.nebius.com/llms.txt)
- Image input: "You can pass images in the following ways: A URL to the image. A base64 encoded image directly in the request."
  - It uses OpenAI-style content parts: `{"type":"image_url","image_url":{"url": ...}}`.
  - The docs example uses `Qwen/Qwen2-VL-72B-Instruct`, which is not in the current catalog (stale example).
  - Sources: [Vision capabilities](https://docs.tokenfactory.nebius.com/api-reference/examples/vision-capabilities); [models_info](https://tokenfactory.nebius.com/api/public/models_info)
- Structured output: `response_format` supports `{"type":"json_schema"}` with a schema, or `{"type":"json_object"}`.
  - The docs advise providing the schema "both in text prompt for the model and `json_schema` parameter".
  - They also say: "Some models are better in providing JSON ... Use `JSON mode` tag ... to find a model with structured output supported."
  - Source: [Structured output & JSON](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
- Function calling follows the OpenAI format, with a `tool_choice` parameter. — [Function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)
- Rate limits, verbatim:
  - "Every user is provided with a default rate limit cap."
  - Defaults are shown in the console at [project/rate-limits](https://tokenfactory.nebius.com/project/rate-limits).
  - Scaling rules: "When average usage in a 15‑minute window ≥ 80% of the current limit, the limit for the next window increases by 20%". When it is ≤ 50%, the limit drops by one-third. There is a hard ceiling of "20× your base allocation".
  - The docs' illustrative table starts at "Baseline ... 60 RPM ... 400,000 TPM".
  - Over-limit requests get HTTP 429. Monitor `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens` and `Retry-After`, and watch for `x-ratelimit-over-limit: yes`. "Use Batch API for async workloads - it has significantly higher limits."
  - Source: [Rate Limits & Scaling](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)
- API keys are created per project, and an organization can hold several projects. — [Organizations and Projects](https://docs.tokenfactory.nebius.com/team-access/org-projects)
- Hackathon submissions need a public open-source repo, and the working project must be free for judges to test. — [Devpost Rules](https://nebiusglobalaihackathon.devpost.com/rules)
- The JS example in the docs sends an OpenAI-style `"user": null` field. — [Vision capabilities](https://docs.tokenfactory.nebius.com/api-reference/examples/vision-capabilities)

### Inferences
- **Recommended key handling for this product:**
  1. **Development:**
     - Put `NEBIUS_API_KEY` in a local `.env` that is gitignored. Commit a `.env.example` with the name only.
     - Use a dedicated Token Factory project, e.g. "dev", so the key can be revoked without touching the demo.
  2. **Demo, judges and any distributed build:**
     - Run a small backend proxy (e.g. one serverless function) that holds the key. Expose one route per task (`/compile`, `/assist`, `/locate`, `/data-step`, `/classify`) rather than a raw pass-through.
     - The app sends events, screenshot and DOM, and never sees the key or the model ID.
     - Use a separate "demo" project and key.
  3. **Why the proxy is required here, not just good practice:**
     - The repo must be public, and a key in the repo or app bundle can be auto-revoked by Nebius when leaked. That would kill the demo during judging.
     - Judges must be able to use the app "free of charge and without any restriction", so they can't be asked for their own keys.
     - No per-key spend cap is documented, and the card is auto-charged when the balance goes negative.
  4. **Controls the proxy should enforce:**
     - Per-install or per-user token, daily request and token quotas.
     - Allow-list of models.
     - Hard `max_tokens` per route.
     - Screenshot downscaling before forwarding.
     - Global daily dollar cap computed from `usage` × catalog price, with a kill-switch.
     - Forwarding of `Retry-After` and backoff on 429.
     - Logging of `x-ratelimit-*` headers.
  5. **End-user experience:** users never handle tokens or cost; the app signs in to the proxy, not to Nebius. Since only API keys exist (no OAuth), a "bring your own Nebius key" mode could be an optional advanced setting, but it should not be the default.
- Use the global base URL. Regional hosts like `api.tokenfactory.us-central1.nebius.com` exist (they appear in the console JavaScript and the docs), but the docs warn they can break for public endpoints.

### Gaps
- The actual default RPM/TPM per model for a new account was not visible without logging in. The 60 RPM / 400K TPM table in the docs is illustrative. Check the console Rate Limits page or `per_request_limits` in `/v1/models?verbose=true`.
- No documentation was found for per-key spend limits, per-key rate limits, or key expiry and scopes for inference keys.
- Whether Token Factory uses the OpenAI `user` field for per-end-user tracking or abuse handling is undocumented.
- No published latency (time to first token) figures were found; only catalog `tokens_per_second` (Section 4).

---

## 4. Model catalog: NVIDIA Nemotron family and vision-capable models on Token Factory (as of 2026-10-07)

### Takeaway
Four NVIDIA models are live on Token Factory serverless, and **all four are text-only**:
- Nemotron 3.5 Lightning (30B / 3B active)
- Nemotron 3 Nano 30B-A3B
- Nemotron 3 Super (120B / 12B active)
- Nemotron 3 Ultra (550B / 55B active)

**No NVIDIA vision-language model is on serverless now.**
- `nvidia/Nemotron-3-Nano-Omni` and `nvidia/Cosmos3-Super-Reasoner` were removed on 31 Aug 2026. Nemotron Nano 12B v2 VL is on Hugging Face but not on Token Factory.
- Image input on Token Factory therefore means a non-NVIDIA model: Qwen3.8-27B, GLM-5.3-Flash, Gemma-3-27B, MiniCPM-V-4.5, DeepSeek-V4.1-Flash, MiniMax-M3, or the Kimi K2.6 / K2.7-Code / K3 family.
- Qwen3-VL, Qwen2.5-VL and Llama 4 vision are **not** in the current catalog.

### Cited Findings

**How to read the table below**
- Sources: the "Token Factory catalog" is the public [models_info JSON](https://tokenfactory.nebius.com/api/public/models_info) (also rendered at [model-catalog.md](https://tokenfactory.nebius.com/model-catalog.md)), read on 2026-10-07. Prices are USD per 1M tokens.
- Speed is the catalog's `tokens_per_second` field. It is a provider-reported throughput, not measured here, and not time to first token.
- "Image input" uses two signals: the catalog's `use_cases` containing `image`, and the Hugging Face `pipeline_tag`. The catalog's own `type` field is unreliable for this; Gemma-3, MiniMax-M3 and Kimi-K2.7-Code are labelled `text2text` but list `image` in their use cases. **None were live-tested with an image here.**

**NVIDIA models live on serverless**

| Model ID (use in `model`) | Params (total / active) | Image input? | Context (TF) | $ in / out per 1M | Speed (tok/s, catalog) | Quant / region | Sources |
|---|---|---|---|---|---|---|---|
| `nvidia/Nemotron-3_5-Lightning` | 30B / 3B active (hybrid Mamba-2 + MoE) | **No.** Card: "Input Type(s): Text" | 1,024K (card: up to 1M) | 0.06 / 0.24 | 314 | bf16 / eu-north1 | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16) |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | ~31B / ~3B active | **No.** HF pipeline `text-generation`; catalog use cases have no `image` | 262K | 0.06 / 0.24 | 60 | fp8 / eu-north1 | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF repo](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8); parameter count from the Omni card's description of its "Nemotron 3 Nano LLM (30B A3B)" backbone: [Omni card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16) |
| `nvidia/nemotron-3-super-120b-a12b` | 120B / 12B active (catalog: "120B hybrid MoE"; active count from the model ID) | **No** per catalog (use cases text only). HF card not verified | 256K | 0.30 / 0.90 | 127 | fp4 / us-central1 | [catalog](https://tokenfactory.nebius.com/api/public/models_info) |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 550B / 55B active (LatentMoE, Mamba-2 hybrid, MTP) | **No.** Card: "Input Type(s): Text" | 1,024K (card: up to 1M) | 1.00 / 3.00 | 523 | fp4 / us-central1 | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4) |

- Reasoning (thinking) mode:
  - Nemotron 3.5 Lightning and Ultra: "Reasoning Mode: Configurable on/off via chat template (`enable_thinking=True/False`)". Lightning's card shows "Reasoning ON (default)" and passes `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` to turn it off.
  - The Ultra card notes that tool calls with reasoning need `"chat_template_kwargs": {"enable_thinking": true, "force_nonempty_content": true}`.
  - Sources: [Lightning card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16); [Ultra card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4)
- Licenses: the catalog lists Nemotron 3.5 Lightning and Ultra under OpenMDW v1.1, and Nano and Super under the NVIDIA Open Model License. — [catalog](https://tokenfactory.nebius.com/api/public/models_info)

**NVIDIA models no longer (or never) on Token Factory serverless**

| Model | Params | Modality | Status on Token Factory | Sources |
|---|---|---|---|---|
| `nvidia/Nemotron-3-Nano-Omni` (Hugging Face: Nemotron-3-Nano-Omni-30B-A3B-Reasoning) | 31B / ~3B active | **"Modalities (in): Video, Audio, Image, Text"**; out: text; up to 256K context; reasoning on by default (`enable_thinking`) | **Removed from serverless 31 Aug 2026.** The recommended replacement, `nvidia/Nemotron-3_5-Lightning`, is text-only | [Aug 2026 deprecations](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice); [HF card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16) |
| `nvidia/Cosmos3-Super-Reasoner` (image2text) | not collected | image→text | **Removed 31 Aug 2026**; replacement MiniMax-M3 | [Aug 2026 deprecations](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice) |
| `nvidia/Llama-3_1-Nemotron-Ultra-253B-v1` | 253B | text | **Removed 31 Aug 2026**; replacement `nvidia/nemotron-3-super-120b-a12b` | [Aug 2026 deprecations](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice) |
| NVIDIA-Nemotron-Nano-12B-v2-VL (BF16 / FP8 / NVFP4) | 12.6B | "Input Type(s): Image, Video, Text"; "Input + Output Token: 128K" | **Not in the serverless catalog.** It would need a dedicated endpoint (custom weights are "beta ... on request") or self-hosting on AI Cloud | [HF card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16); [catalog](https://tokenfactory.nebius.com/api/public/models_info); [Custom weights](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/custom-weights) |
| Llama-3.1-Nemotron-Nano-VL-8B-V1 | 8B | image-text-to-text | Not in the serverless catalog | [HF search](https://huggingface.co/models?author=nvidia&search=Nemotron-Nano-VL); [catalog](https://tokenfactory.nebius.com/api/public/models_info) |

- The August 2026 notice, verbatim: "These models will be removed from Token Factory on August 31, 2026 ... Token Factory does not automatically reroute requests from deprecated models." It also removed `Qwen/Qwen2.5-VL-72B-Instruct` (replacement MiniMax-M3), `meta-llama/Llama-3.3-70B-Instruct`, `Qwen/Qwen3-32B` and `NousResearch/Hermes-4-70B` (all replaced by Nemotron-3.5-Lightning), among others. — [Aug 2026 deprecations](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice)
- The June 2026 wave removed 11 serverless models on 22 June, including `moonshotai/Kimi-K2.5`, `deepseek-ai/DeepSeek-V3.2` and `zai-org/GLM-5`. — [June 2026 deprecations](https://docs.tokenfactory.nebius.com/june-2026-deprecation-notice)

**Vision-capable (image-input) models live on serverless (non-NVIDIA)**

| Model ID | Params | Image evidence | Context (TF) | $ in / out per 1M | Speed (tok/s) | Image tokens per screenshot | Sources |
|---|---|---|---|---|---|---|---|
| `Qwen/Qwen3.8-27B` | 27B dense (HF 27.8B) | catalog `image2text`; HF `image-text-to-text`; card has an "Image Input" section | 262K | 0.45 / 3.00 | 218 | About (W/32)×(H/32), from `patch_size: 16`, `merge_size: 2`. So ~1,000 at 1280×800, ~2,040 at 1920×1080, ~5,040 at 2880×1800 (computed, not measured) | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF card](https://huggingface.co/Qwen/Qwen3.8-27B); [preprocessor_config](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/preprocessor_config.json) |
| `zai-org/GLM-5.3-Flash` | 320B / 18B active (catalog); HF 321B | catalog `image2text`; HF `image-text-to-text` | 1,024K | 0.15 / 0.50 | 349 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF](https://huggingface.co/zai-org/GLM-5.3-Flash) |
| `google/gemma-3-27b-it` | 27B | catalog use case `image` (type says `text2text`); HF `image-text-to-text` | 110K (card: 128K) | 0.10 / 0.30 | 20 | "Images, normalized to 896 x 896 resolution and encoded to 256 tokens each" | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [Gemma 3 model card](https://ai.google.dev/gemma/docs/core/model_card_3) |
| `openbmb/MiniCPM-V-4_5` | 8B (HF 8.7B) | catalog `image2text`; catalog tag "JSON mode"; HF `image-text-to-text` | **32K** | 0.658 / 1.11 | 49.5 | 64 tokens per image unit ("the same token count used for a single image in MiniCPM-V series"). High-resolution images are sliced, so real counts are higher | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF card](https://huggingface.co/openbmb/MiniCPM-V-4_5) |
| `deepseek-ai/DeepSeek-V4.1-Flash` | not stated in catalog; HF safetensors total ~763B (unverified as true parameter count) | catalog `image2text`; HF `image-text-to-text` | 1,048K | 0.30 / 1.20 | 139 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) |
| `MiniMaxAI/MiniMax-M3` | 428B MoE (catalog) | catalog use cases `image`, `video` (type `text2text`); HF `image-text-to-text` | 1,049K | 0.30 / 1.20 | 248 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF](https://huggingface.co/MiniMaxAI/MiniMax-M3) |
| `moonshotai/Kimi-K2.6` | ~1T (HF safetensors) | catalog `image2text`; "native multimodal" | 256K | 0.95 / 4.00 | 60 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF](https://huggingface.co/moonshotai/Kimi-K2.6) |
| `moonshotai/Kimi-K2.7-Code` | ~1T (HF safetensors) | catalog use case `image` (type `text2text`); HF `image-text-to-text` | 256K | 0.95 / 4.00 | 231 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info); [HF](https://huggingface.co/moonshotai/Kimi-K2.7-Code) |
| `moonshotai/Kimi-K3` | not stated | catalog `image2text` | 1,024K | 3.00 / 15.00 | 265 | not collected | [catalog](https://tokenfactory.nebius.com/api/public/models_info) |

- Qwen3.8 runs in thinking mode by default: "Qwen3.8 models operate in thinking mode by default". It is disabled via `"chat_template_kwargs": {"enable_thinking": False}`. — [Qwen3.8-27B card](https://huggingface.co/Qwen/Qwen3.8-27B)

**Other text models live on serverless (for reference)**

All from the [catalog](https://tokenfactory.nebius.com/api/public/models_info):

| Model ID | Size (catalog) | Context | $ in / out per 1M | Speed (tok/s) |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | 120B | 131K | 0.15 / 0.60 | 40 |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 30.5B | 262K | 0.10 / 0.30 | 70 |
| `Qwen/Qwen3-235B-A22B-Instruct-2507` | 235B | 262K | 0.20 / 0.60 | 27 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 304B | 1,024K | 0.14 / 0.28 | 351 |
| `deepseek-ai/DeepSeek-V4-Pro` | 862B | 1,000K | 1.75 / 3.50 | 24 |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | not stated | 979K | 1.32 / 3.96 | 37 |
| `Qwen/Qwen3.5-397B-A17B` | not stated | 262K | 0.60 / 3.60 | 80 |
| `zai-org/GLM-5.1` | 750B | 200K | 1.40 / 4.40 | 25 |
| `zai-org/GLM-5.2` | not stated | 1,024K | 1.40 / 4.40 | 25 |
| `zai-org/GLM-5.3` | not stated | 1,024K | 1.40 / 4.40 | 455 |
| `NousResearch/Hermes-4-405B` | 405B | 128K | 1.00 / 3.00 | 20 |
| `Qwen/Qwen3-Embedding-8B` (embedding) | 8B | 41K | 0.01 per 1M (input only) | n/a |

"Not stated" means the catalog's `size_b` field is 0 for that model.

- The catalog had 25 public models on 2026-10-07. — [catalog](https://tokenfactory.nebius.com/api/public/models_info)

### Inferences
- **The required NVIDIA model cannot see screenshots on Token Factory serverless today.** The design that fits both the rules and the budget:
  - Nemotron handles every text-reasoning step: compile, replay decisions over DOM or accessibility text, data steps, classification.
  - A non-NVIDIA vision model on Token Factory is called only when pixels are truly needed.
  - The video and README should then show Nemotron on the critical path, since that is what judging asks about.
- Self-hosting Nemotron Nano 12B v2 VL or Nano Omni on a dedicated endpoint or on AI Cloud would give an all-NVIDIA vision path, but it is not recommended:
  - It is billed per GPU-hour on the card (no AI Cloud credits), and custom weights are "beta, on request".
  - It would have to stay up through judging (1–15 Dec).
- Among vision models for UI screenshots:
  - **GLM-5.3-Flash** is the cheapest fast option ($0.15/$0.50, 349 tok/s).
  - **Qwen3.8-27B** is the best-documented: dense 27B, known image-token formula, Qwen VL lineage for UI and OCR. It is pricier on output ($3.00/M), and its thinking mode must be turned off.
  - **Gemma-3-27B** is the cheapest per image (256 tokens), but every image is squashed to 896×896, which loses small UI text, and it runs at 20 tok/s.
  - **MiniCPM-V-4.5** has only 32K context.
- Treat model IDs as unstable. The June and August 2026 waves removed models with about one month's notice, and the docs' own examples reference removed models. Keep model IDs in one config file on the proxy.

### Gaps
- None of the image-capable models was tested with a live image request (that needs an API key). Confirm by running `curl -s 'https://api.tokenfactory.nebius.com/v1/models?verbose=true' -H "Authorization: Bearer $NEBIUS_API_KEY" | jq '.data[] | {id, modality: .architecture.modality, image_price: .pricing.image, ctx: .context_length, limits: .per_request_limits}'`. That command is adapted from the [List of models](https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models) doc.
- Whether images carry a separate per-image price (`pricing.image`) for any vision model was not visible in the public catalog, which only shows token prices.
- Nemotron 3 Super's Hugging Face card (the catalog links `nvidia/Nemotron-3-Super-120B`) returned an auth error, so its modality and active-parameter count were not verified against the card.
- Image-token counts for GLM-5.3-Flash, DeepSeek-V4.1-Flash, MiniMax-M3 and Kimi were not collected.
- The Ultra model's 523 tok/s versus Nano's 60 tok/s in the catalog looks counter-intuitive, but it likely reflects deployment differences (B200, speculative decoding). It was not measured.
- Whether Token Factory honors `chat_template_kwargs.enable_thinking` for Nemotron or Qwen3.8 was not tested.
- build.nvidia.com was not researched, because the FAQ says NVIDIA models served by other providers do not satisfy the rules.

---

## 5. Which model size for which task in the record-and-replay product, with cost per call

### Takeaway
- **Small: Nemotron 3.5 Lightning** ($0.06/$0.24, 314 tok/s, 1M context, thinking off). Use it for live help, classification, simple data steps, and the first try at replay fallback.
- **Medium: Nemotron 3 Super** ($0.30/$0.90, 256K). Use it for compiling a recording into skill JSON, and for hard replay or data decisions with thinking on.
- **Large: Nemotron 3 Ultra** ($1/$3, 1M context). Use it only for long recordings, or when Super's output fails schema validation.
- **Vision when needed:** GLM-5.3-Flash (cheap and fast) or Qwen3.8-27B (best documented), on screenshots downscaled to about 1280 px wide.

At these prices, $25–50 covers thousands of compiles and hundreds of thousands of small calls. Thinking tokens and full-resolution Retina screenshots are the main cost drivers.

### Cited Findings
- Prices, context and speed are from the catalog tables in Section 4. — [catalog](https://tokenfactory.nebius.com/api/public/models_info)
- The hackathon's guidance: "Reach for Nemotron 3 Ultra when you need serious reasoning, and let Nano or Super handle the fast, everyday calls, so your app stays responsive and your credits stretch further." — [Devpost overview](https://nebiusglobalaihackathon.devpost.com/)
- Nemotron 3.5 Lightning is "designed for efficient agentic reasoning, tool use, coding, and long-context workflows". Super is "optimized for efficient multi-agent AI and complex reasoning tasks". Ultra is "optimized for the most demanding multi-agent AI and complex reasoning tasks". — [catalog](https://tokenfactory.nebius.com/api/public/models_info)
- Image-token sizes:
  - Qwen3.8-27B: `patch_size: 16`, `merge_size: 2`, which is 32 px per visual token per side. — [Qwen3.8 preprocessor_config](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/preprocessor_config.json)
  - Gemma 3: 256 tokens per image at 896×896. — [Gemma 3 model card](https://ai.google.dev/gemma/docs/core/model_card_3)
- Structured JSON output (`json_schema` / `json_object`) and function calling are supported through the OpenAI-compatible API. — [Structured output & JSON](https://docs.tokenfactory.nebius.com/ai-models-inference/json); [Function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)
- The Batch API "has significantly higher limits" for async workloads. — [Rate Limits & Scaling](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)

### Inferences

**Recommendations by task**

Costs in the next table are computed as tokens × catalog price.

| Task | Needs vision? | Small | Medium (default) | Large / escalation | Notes |
|---|---|---|---|---|---|
| **A. Compile a recording into a skill** (events + DOM/AX + screenshots → structured skill JSON; offline, once per recording) | Usually **no** for browser recordings: DOM selectors, labels and accessibility text carry the meaning. **Yes** for canvas UIs or Mac apps with poor accessibility trees | Nemotron 3.5 Lightning (draft step names, cheap retries) | **Nemotron 3 Super** with `json_schema`, thinking on | Nemotron 3 Ultra for very long recordings or on validation failure | For pixel-only steps, add a **vision pre-pass**: GLM-5.3-Flash or Qwen3.8-27B captions the keyframes into text, then Nemotron compiles. Nemotron stays on the critical path |
| **B. Live help during recording** (low latency) | No; send recent events and the focused element as text | **Nemotron 3.5 Lightning**, thinking off, `max_tokens` about 200, streaming | Nemotron 3 Super only for rare "explain this" requests | none | Lightning is listed at 314 tok/s, so 150 tokens take about 0.5 s of generation plus time to first token (unmeasured). Nano 30B-A3B costs the same but is listed at 60 tok/s |
| **C. Replay fallback** (element missing → which element?) | Try text first; vision only if the DOM or accessibility tree can't settle it | **Nemotron 3.5 Lightning** over a numbered candidate list (DOM snippet + recorded target description), returning `{candidate_id, confidence}` | Nemotron 3 Super with thinking on for ambiguous cases. **Vision:** GLM-5.3-Flash or Qwen3.8-27B with a downscaled screenshot (ideally with numbered overlays) | Kimi-K2.6 or MiniMax-M3 only if the smaller vision models fail in testing | Make the model choose among candidates you extracted, not produce free coordinates. Cheaper and checkable |
| **D. Per-run data step** (choose a row, summarise) | No | **Nemotron 3.5 Lightning** for small tables or simple criteria | Nemotron 3 Super for large tables, fuzzy criteria or summaries | Nemotron 3 Ultra for very long inputs (1M context) | Use `json_schema` output so replay can consume it directly |
| **E. Cheap classification** (intent, step type, success or failure) | No | **Nemotron 3.5 Lightning**, thinking off, `max_tokens` ≤ 10 | none | none | Alternative: `Qwen/Qwen3-Embedding-8B` ($0.01/M) with nearest-neighbour labels. Not NVIDIA, so keep Nemotron as the primary path |

**Per-call cost estimates**

All token counts are assumptions, stated in each row. Prices are the 2026-10-07 catalog prices. "Thinking on" adds the stated number of output tokens, which bill as output.

| Task / scenario | Model | Input tokens | Output tokens | Cost per call | Calls per $25 |
|---|---|---:|---:|---:|---:|
| A. Compile, text only (40 events × 60 + DOM 6K + prompt/schema 1.5K ≈ 10K), thinking off | Nemotron 3 Super | 10,000 | 2,000 | $0.0048 | ~5,200 |
| A. Same, thinking on (+3K) | Nemotron 3 Super | 10,000 | 5,000 | $0.0075 | ~3,300 |
| A. Same, thinking off | Nemotron 3 Ultra | 10,000 | 2,000 | $0.016 | ~1,560 |
| A. Same, thinking on (+3K) | Nemotron 3 Ultra | 10,000 | 5,000 | $0.025 | ~1,000 |
| A. Same, thinking off | Nemotron 3.5 Lightning | 10,000 | 2,000 | $0.0011 | ~23,000 |
| A. Vision pre-pass: 10 keyframes at 1280×800 (~10K image + 1K text), 1K captions, thinking off | Qwen3.8-27B | 11,000 | 1,000 | $0.0080 | ~3,100 |
| A. Same, thinking on (+2K) | Qwen3.8-27B | 11,000 | 3,000 | $0.014 | ~1,800 |
| A. Same token assumption (GLM's image-token count is unverified) | GLM-5.3-Flash | 11,000 | 1,000 | $0.0022 | ~11,600 |
| A. 10 keyframes at 256 tokens each + 1K text | Gemma-3-27B | 3,560 | 1,000 | $0.00066 | ~38,000 |
| B. Live help (1.5K context, 150 out), thinking off | Nemotron 3.5 Lightning (or Nano 30B-A3B) | 1,500 | 150 | $0.00013 | ~198,000 |
| B. Same | Nemotron 3 Super | 1,500 | 150 | $0.00059 | ~43,000 |
| C. Fallback, text (DOM 3K + target description 300), 100 out | Nemotron 3.5 Lightning | 3,300 | 100 | $0.00022 | ~113,000 |
| C. Same, thinking on (+1K) | Nemotron 3 Super | 3,300 | 1,100 | $0.0020 | ~12,600 |
| C. Fallback, vision: 1 screenshot at 1280×800 (~1K) + 3.3K text | Qwen3.8-27B | 4,300 | 100 | $0.0022 | ~11,200 |
| C. Same with a full Retina 2880×1800 screenshot (~5,040) | Qwen3.8-27B | 8,340 | 100 | $0.0041 | ~6,200 |
| C. Fallback, vision (~1K image tokens assumed) | GLM-5.3-Flash | 4,300 | 100 | $0.0007 | ~36,000 |
| C. Fallback, vision (256 image tokens) | Gemma-3-27B | 3,556 | 100 | $0.0004 | ~65,000 |
| D. Data step (50-row table ≈ 2K + 500 prompt), 300 out | Nemotron 3.5 Lightning | 2,500 | 300 | $0.00022 | ~113,000 |
| D. Same | Nemotron 3 Super | 2,500 | 300 | $0.0010 | ~24,500 |
| D. Large table (20K), 500 out | Nemotron 3 Super | 20,000 | 500 | $0.0065 | ~3,900 |
| E. Classification (500 in, 10 out) | Nemotron 3.5 Lightning | 500 | 10 | $0.000032 | ~770,000 |
| E. Embedding-based classification (500 tokens) | Qwen3-Embedding-8B | 500 | 0 | $0.000005 | ~5,000,000 |

**Cost and latency levers**, roughly in order of impact:
1. Turn off thinking on the latency-sensitive and cheap paths. Nemotron 3.x/3.5 and Qwen3.8 default to thinking on, and thinking tokens bill as output.
2. Downscale screenshots to about 1280 px wide before sending. A Retina capture costs about 5× the image tokens on Qwen3.8.
3. Send DOM or accessibility candidates as text and ask for a candidate ID. This keeps most calls on Nemotron and avoids vision entirely.
4. Cap `max_tokens` per route in the proxy.
5. Use the Batch API for any bulk offline re-compiles.

**Budget sense-check:** even an expensive mix (one compile with thinking on Super, plus 10 vision fallbacks on Qwen3.8 at full Retina resolution, per demo run) costs about $0.05. So $25 covers about 500 such runs, and $50 about 1,000. A demo through judging fits within the credits if the proxy caps abuse.

### Gaps
- The token counts above are assumptions, not measured on this product's recordings. Log `usage.prompt_tokens` and `usage.completion_tokens` from real calls and recompute.
- Image-token accounting on Token Factory for each vision model is unverified. Pan-and-scan for Gemma, slicing for MiniCPM, and GLM's and Kimi's tokenizers were not checked. Check the `usage` field of a real image request.
- Time to first token for each model on Token Factory was not found. Measure Lightning against Nano against Super for the live-help path before committing.
- No benchmark was found on how well these models ground UI elements from screenshots. Accuracy of GLM-5.3-Flash versus Qwen3.8-27B versus Gemma-3 on the user's own apps needs a small evaluation, e.g. 20 recorded fallback cases.
- Whether `json_schema` strict mode works on the Nemotron models was not confirmed. The docs say to look for a "JSON mode" tag, and in the public catalog only MiniCPM-V-4.5 carries it.
