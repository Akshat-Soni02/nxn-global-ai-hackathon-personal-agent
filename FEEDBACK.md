# Feedback: Token Factory, AI Cloud and Nemotron

What we found while building Shadow. Each point comes from a run or a measurement in this repository.

## Nebius Token Factory

**What worked well**
- The OpenAI-compatible API, `json_schema` output, tool calling and the thinking switch all worked the same way across both Nemotron models. Adding a model was a catalog row.
- Prompt caching happens by itself and saves most of an agent's repeated input (2,784 of 2,806 tokens on a repeated design prompt).
- Zero Data Retention as one organisation-wide setting made the privacy story simple to explain and to check.

**What was hard**
- **Reasoning and the answer share one `max_tokens` budget.** With thinking on, Nemotron 3 Super once spent the whole 8,192-token budget on reasoning while writing a workflow, and returned no answer. We doubled the budget to 16,384. A separate reasoning budget, or a clear error when reasoning uses up `max_tokens`, would make this easy to spot.
- **Cached tokens have no published price.** Usage reports `cached_tokens`, but we can't price them. Shadow's meter therefore charges every input token in full, so the costs we show are an upper bound.
- **Reliable structured output needed the schema twice**, in `response_format` and in the prompt, as Nebius's docs recommend. We also kept fallbacks: `json_schema`, then `json_object`, then text.
- **The catalog changes often.** Models were removed in waves while we built. We keep model ids in config so a swap is one line. Deprecation dates in `/v1/models` would help builders plan.
- **Onboarding needs a bank card** before the $1 trial credit. That was fine for us, but it is a hurdle for students.

## NVIDIA Nemotron

**What worked well**
- Nemotron 3 Super with tools reads a messy recording and builds a workflow with loops, branches, AI steps and connected-app steps. On a real YC → Google Sheets recording, its 7th re-design finished right: the right columns, the first 5 jobs, 3 AI calls. Most of the earlier stalls were slips of form (below), which code now settles.
- Nemotron 3.5 Lightning is fast and cheap enough to sit inside every scheduled run.

**What was hard**
- **One tool call per turn.** In 17 of 18 saved designs, every model call carried a single tool action, so long designs ran out of calls. We redesigned around it: one call now plans every change, and code applies them.
- **Slips in tool arguments.** In one design, the workflow arrived as a JSON string with its quotes escaped twice (9 times). Other slips: camelCase names where the schema used snake_case, and extra "end" markers. Shadow now settles these in code instead of refusing.
- **It reaches for an AI step for list work that code can do**, such as "the first 5" or "flatten this list". Once, this made a real run hit its limit of AI calls. Code now counts a design's AI calls and refuses list counting inside AI steps.

## Nebius AI Cloud

We didn't use it, so we have no feedback to give. Our only server is a small stateless container, and AI Cloud's compute is where we would try it next.
