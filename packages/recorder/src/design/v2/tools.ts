// Design agent v2's tools (spec, "Tools" and "Forgiveness"). Built from the Oct 19 runs, where 6 of 11 and 9 of 16
// turns went on calls the old tools rejected: inputs sent as JSON strings, a loop with no steps, a step missing its
// type, an id the tool didn't know. Here a field sent as a string is parsed; a step is written as what it does
// ({ do: "click" }) and code fills in its channel, action and type; an unknown id is answered with the real ones; a
// wrong tool gets the right call back; and several calls run in one turn (callsPerTurn). Every change carries a `why`
// the review shows. Only what is harmful is refused (rules.ts); approval on outward steps is added by code.
import { type AnyTool, type ToolContext, tool } from "@shadow/agent";
import {
  applyEdits,
  type EditInput,
  isAction,
  type Locator,
  type Step,
  triggerOf,
  type VarType,
  walkSteps,
} from "@shadow/core";
import { z } from "zod";
import { requireApprovals } from "../../approvals.ts";
import { producedType } from "../../compile.ts";
import { maskText } from "../../mask.ts";
import { DoneReport } from "./contracts.ts";
import { outlineOf } from "./outline.ts";
import { refusals } from "./rules.ts";
import { MAX_DONE_REFUSALS, MAX_TESTS, type SessionV2 } from "./session.ts";

// A tool input, or one of its fields, sent as a JSON string: parsed. Anything that isn't JSON stays as it was.
export function unstring(value: unknown): unknown {
  const parse = (v: unknown) => {
    if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const top = parse(value);
  if (!top || typeof top !== "object" || Array.isArray(top)) return top;
  return Object.fromEntries(Object.entries(top).map(([k, v]) => [k, parse(v)]));
}

// What a step can do, as the model writes it, and the channel and action it becomes. "web.click" works too.
const DO: Record<string, [string, string]> = {
  open: ["web", "navigate"],
  click: ["web", "click"],
  type: ["web", "type"],
  select: ["web", "select"],
  press: ["web", "press"],
  read: ["web", "extract"],
  read_all: ["web", "extract"],
  read_sheet: ["web", "extract"],
  wait: ["web", "wait_for"],
  upload: ["web", "upload"],
  find_files: ["fs", "find"],
  read_file: ["fs", "read"],
  move_file: ["fs", "move"],
  copy_file: ["fs", "copy"],
  rename_file: ["fs", "rename"],
  pick_row: ["data", "pick"],
  open_app: ["ax", "open"],
  press_in_app: ["ax", "press"],
  type_in_app: ["ax", "set_value"],
  menu: ["ax", "menu"],
  key_in_app: ["ax", "key"],
};

const LocatorSpec = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  near: z.string().optional(),
});
// A control: the target of a recorded step ({ like: "s3" }), or one described by role and name (a new target: it
// stays unverified until the test run finds it on the live page).
const TargetSpec = z.union([z.object({ like: z.string() }), LocatorSpec]);
// A step as the model writes it: what it does, what for, its control, and its values (at the top or under args).
const StepSpec = z
  .object({
    do: z.string(),
    intent: z.string().min(1),
    target: TargetSpec.optional(),
    tab: z.string().optional(),
    save_as: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
type StepSpec = z.infer<typeof StepSpec>;
const Where = { after: z.string().optional(), before: z.string().optional(), into: z.string().optional() };
const Why = z.string().default("");

export function designToolsV2(session: SessionV2): AnyTool<DoneReport>[] {
  const ids = () => [...walkSteps(session.draft.steps)].map(({ step }) => step.id);
  const known = (id: string) => ids().includes(id);
  const unknown = (id: string) => `no step ${id}. Steps: ${ids().join(", ")}`;
  const nextId = (prefix: string) => {
    const used = new Set([...ids(), ...session.dropped.keys()]);
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  // A recorded step anywhere: in the draft, the recording, or what code left out.
  const anyStep = (id: string): Step | undefined =>
    [...walkSteps(session.draft.steps), ...walkSteps(session.original.steps)].find(({ step }) => step.id === id)?.step;
  const position = (where: { after?: string; before?: string; into?: string }) =>
    where.into ? { into: where.into } : where.before ? { before: where.before } : { after: where.after ?? lastTop() };
  const lastTop = () => session.draft.steps.at(-1)?.id ?? "start";

  // Edits applied to the draft: they must parse and break no rule. Approval on outward steps is added here, by code.
  const apply = (edits: EditInput[], why: string, touched: string[], unverified: string[] = []) => {
    const result = applyEdits(session.draft, edits);
    if (!result.ok) return { output: { ok: false, problems: result.problems.map(hint) } };
    const refused = refusals(session.original, result.skill, session.facts);
    if (refused.length > 0) return { output: { ok: false, refused } };
    const approved = requireApprovals(result.skill);
    session.draft = approved.skill;
    for (const id of touched) if (why) session.whys.set(id, why);
    for (const id of unverified) session.unverified.add(id);
    return {
      output: {
        ok: true,
        ...(approved.added.length > 0 ? { approval_added: approved.added } : {}),
        workflow: outlineOf(session.draft),
      },
    };
  };
  // The edit layer's messages, with what to do about them.
  const hint = (problem: string): string => {
    const missing = /no step (\S+)/.exec(problem)?.[1];
    if (missing) return `${problem}. Steps: ${ids().join(", ")}`;
    if (/steps.*(at least|too small)/i.test(problem))
      return `${problem}: give loop or branch the steps to repeat (steps: [ids])`;
    return problem;
  };

  // A step spec -> an action step: channel, action and type from `do`, the target copied or new, values as args.
  const compile = (
    spec: StepSpec,
    id: string,
  ): { step: Record<string, unknown>; unverified: boolean } | { error: string } => {
    const { do: verb, intent, target, tab, save_as, args, ...rest } = spec;
    const pair = DO[verb] ?? (/^(web|fs|data|ax)\.\w+$/.test(verb) ? (verb.split(".") as [string, string]) : undefined);
    if (!pair) {
      return {
        error: `"${verb}" is not something a step can do. Use one of: ${Object.keys(DO).join(", ")} (or channel.action, such as web.click). To repeat steps use loop; to decide use branch; to work something out from text use ai_step`,
      };
    }
    const [channel, action] = pair;
    const values: Record<string, unknown> = { ...rest, ...(args ?? {}) };
    if (verb === "read_all") values.all = true;
    if (verb === "read_sheet") values.source = "google_sheet";
    // A page by name ("s1", "KPI Sheet"): the text the agent reads masks ids inside addresses, so code writes it.
    if (action === "navigate" && typeof values.page === "string") {
      const url = session.pages.get(values.page);
      if (!url) return { error: `no page ${values.page}. Pages: ${[...session.pages.keys()].join(", ") || "none"}` };
      values.url = url;
      delete values.page;
    }
    let locator: Locator | undefined;
    let unverified = false;
    if (target && "like" in target) {
      const like = anyStep(target.like);
      if (!like || !isAction(like) || !like.target)
        return { error: `${target.like} has no control to copy: ${unknown(target.like)}` };
      locator = like.target;
    } else if (target) {
      locator = { ...target, fallbacks: [] };
      unverified = true;
    }
    const step: Record<string, unknown> = {
      id,
      type: "action",
      intent,
      channel,
      action,
      args: values,
      ...(locator ? { target: locator } : {}),
      ...(tab ? { tab } : {}),
    };
    if (save_as) step.output = { name: save_as, type: producedType({ channel, action, args: values } as never) };
    return { step, unverified };
  };

  // The type of the items of a list variable, so a loop's item fits it (check.ts compares them).
  const itemType = (name: string): VarType | undefined => {
    const bare = name.replace(/^\{\{|\}\}$/g, "").trim();
    const input = triggerOf(session.draft).inputs[bare];
    const found =
      input?.type ??
      [...walkSteps(session.draft.steps)]
        .map(({ step }) => ("output" in step && step.output?.name === bare ? step.output.type : undefined))
        .find(Boolean);
    return found?.type === "list" ? found.items : undefined;
  };

  const loop: AnyTool<DoneReport> = tool({
    name: "loop",
    kind: "edit",
    description:
      'Repeat steps that sit next to each other for every item of a list an earlier step produces: over "{{list}}" (or its name), item { name } (used inside as {{name}}). The common shape: read a list, pick the items wanted (ai_step or a pick_row), loop over them',
    input: z.object({
      steps: z.array(z.string()),
      over: z.string().min(1),
      item: z.object({ name: z.string().min(1), type: z.record(z.string(), z.unknown()).optional() }),
      intent: z.string().min(1),
      on_item_fail: z.enum(["stop", "skip"]).optional(),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, over, item, intent, on_item_fail, why }) => {
      if (steps.length === 0)
        return {
          output: { ok: false, problems: ["loop needs the steps to repeat (steps: [ids]): it moves them inside"] },
        };
      const missing = steps.find((s) => !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("l");
      const list = /^\{\{.*\}\}$/.test(over.trim()) ? over.trim() : `{{${over.trim()}}}`;
      const type = item.type ?? itemType(list) ?? { type: "object" };
      const shell = {
        id,
        type: "control",
        kind: "loop",
        intent,
        over: list,
        item: { name: item.name, type },
        on_item_fail,
        steps: [],
      };
      return apply(
        [
          { op: "insert", at: { before: steps[0] as string }, step: shell },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
        ],
        why,
        [id, ...steps],
      );
    },
  });

  const branch: AnyTool<DoneReport> = tool({
    name: "branch",
    kind: "edit",
    description:
      "Do steps that sit next to each other only when a condition holds: if { left, op, right } (equals, not_equals, contains, greater_than, less_than, exists, not_exists), else: steps for when it doesn't",
    input: z.object({
      steps: z.array(z.string()),
      if: z.record(z.string(), z.unknown()),
      else: z.array(z.string()).optional(),
      intent: z.string().min(1),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, if: condition, else: otherwise, intent, why }) => {
      if (steps.length === 0)
        return { output: { ok: false, problems: ["branch needs the steps it guards (steps: [ids])"] } };
      const missing = [...steps, ...(otherwise ?? [])].find((s) => !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("b");
      return apply(
        [
          {
            op: "insert",
            at: { before: steps[0] as string },
            step: { id, type: "control", kind: "branch", intent, if: condition, steps: [], else: [] },
          },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
          ...(otherwise ?? []).map((s): EditInput => ({ op: "move", step: s, to: { into: id, arm: "else" } })),
        ],
        why,
        [id, ...steps, ...(otherwise ?? [])],
      );
    },
  });

  const aiStep: AnyTool<DoneReport> = tool({
    name: "ai_step",
    kind: "edit",
    description:
      "Add a step that reads text and works one value out of it (pick the newest, the ones not already in the sheet, a category, a summary). It never clicks or types. inputs: references such as {{emails}}",
    input: z.object({
      after: z.string(),
      intent: z.string().min(1),
      instruction: z.string().min(1),
      inputs: z.array(z.string()).min(1),
      output: z.object({ name: z.string().min(1), type: z.record(z.string(), z.unknown()).optional() }),
      why: Why,
    }),
    prepare: unstring,
    run: ({ after, intent, instruction, inputs, output, why }) => {
      if (!known(after)) return { output: { ok: false, problems: [unknown(after)] } };
      const id = nextId("ai");
      const refs = inputs.map((i) => (/^\{\{.*\}\}$/.test(i.trim()) ? i.trim() : `{{${i.trim()}}}`));
      return apply(
        [
          {
            op: "insert",
            at: { after },
            step: {
              id,
              type: "llm",
              intent,
              instruction,
              inputs: refs,
              output: { name: output.name, type: output.type ?? { type: "text" } },
            },
          },
        ],
        why,
        [id],
      );
    },
  });

  const ask: AnyTool<DoneReport> = tool({
    name: "ask",
    kind: "look",
    description:
      'Queue a question for the user: only what the recording, the goal and what they said can\'t answer. step: the step its answer changes ("start" for how often it runs and its inputs). Asked after you build, with the others, in one batch',
    input: z.object({
      question: z.string().min(1),
      why: z.string().min(1),
      step: z.string(),
      options: z.array(z.string()).max(6).optional(),
      default: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    prepare: unstring,
    run: ({ question, why, step, options, default: fallback, confirm }) => {
      if (step !== "start" && !known(step)) return { output: { ok: false, problems: [unknown(step)] } };
      const seen = session.evidence?.about(question) ?? [];
      if (seen.length > 0 && !confirm) {
        return {
          output: {
            not_asked: "The recording may already answer this: use it. If it doesn't, ask again with confirm: true.",
            seen,
          },
          untrusted: true,
        };
      }
      const key = (s: string, q: string) =>
        `${s}|${q
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}`;
      if (session.questions.some((q) => key(q.step, q.text) === key(step, question))) {
        return { output: { ok: true, note: "already queued" } };
      }
      const id = `q${session.questions.length + 1}`;
      session.questions.push({
        id,
        text: question,
        why,
        step,
        options: options ?? [],
        ...(fallback ? { default: fallback } : {}),
      });
      return { output: { queued: id, note: "asked after you build, with the other questions, in one batch" } };
    },
  });

  // The safe test run, inside the episode (the agent loop has no step between turns): at most MAX_TESTS per design.
  const test = async (): Promise<unknown> => {
    if (!session.runTest) {
      return "the test run can't run here (Chrome isn't connected to Shadow): finish, and the review will say it wasn't tested";
    }
    if (session.tests >= MAX_TESTS)
      return `tested ${MAX_TESTS} times already: finish, explaining in done what still fails`;
    session.tests++;
    const report = await session.runTest();
    session.lastTest = report;
    session.testedDraft = JSON.stringify(session.draft.steps);
    const ids = (status: string) => report.steps.filter((s) => s.status === status).map((s) => s.id);
    const why = (status: string) =>
      report.steps.filter((s) => s.status === status).map((s) => `${s.id}: ${s.error ?? status.replace("_", " ")}`);
    return {
      outcome: report.outcome,
      done: ids("done"),
      found: ids("found"),
      not_found: why("not_found"),
      failed: why("failed"),
      not_reached: ids("not_reached"),
    };
  };

  const done: AnyTool<DoneReport> = tool({
    name: "done",
    kind: "finish",
    description:
      "The workflow does what they meant: one sentence on what you changed, and for each rule of the task model (by its number) the steps that build it, or not_built with why",
    input: DoneReport,
    prepare: unstring,
    run: async (report) => {
      // A workflow changed since its last test is tested once more first: the gate reads the report.
      if (session.runTest && session.testedDraft !== JSON.stringify(session.draft.steps) && session.tests < MAX_TESTS) {
        await test();
      }
      const left = session.finish?.(report) ?? [];
      if (left.length > 0 && session.refusedDone < MAX_DONE_REFUSALS) {
        session.refusedDone++;
        return { output: { refused: "not finished yet", problems: left } };
      }
      // Refused twice: saved with what is left listed for the user, never lost.
      session.gaps = left;
      return {
        output: left.length > 0 ? { finished: "with gaps the review lists", gaps: left } : "finished",
        finish: report,
      };
    },
  });

  const tools: AnyTool<DoneReport>[] = [
    tool({
      name: "accept",
      kind: "edit",
      description:
        "Use a change code prepared from the recording (a proposal, by id): repeat steps for every item, today's date, an item of a list, open a page directly. Say why it fits what they meant",
      input: z.object({ proposal: z.string(), why: Why }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        const p = session.proposals.get(proposal);
        if (!p)
          return {
            output: {
              ok: false,
              problems: [`no proposal ${proposal}. Proposals: ${[...session.proposals.keys()].join(", ") || "none"}`],
            },
          };
        if (session.decisions.has(proposal))
          return { output: { ok: false, problems: [`${proposal} is decided already`] } };
        if (!p.runnable || p.edits.length === 0) {
          session.decisions.set(proposal, { decision: "accept", why });
          return {
            output: {
              ok: true,
              note: p.runnable ? "nothing to change" : "noted for the review: replay can't do this yet",
            },
          };
        }
        const result = apply(p.edits, why, p.steps);
        if ((result.output as { ok: boolean }).ok) session.decisions.set(proposal, { decision: "accept", why });
        return result;
      },
    }),
    tool({
      name: "reject",
      kind: "edit",
      description: "Say a proposal doesn't fit what they meant, and why (it is shown in the review)",
      input: z.object({ proposal: z.string(), why: z.string().min(1) }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        if (!session.proposals.has(proposal)) return { output: { ok: false, problems: [`no proposal ${proposal}`] } };
        session.decisions.set(proposal, { decision: "reject", why });
        return { output: { ok: true } };
      },
    }),
    tool({
      name: "remove",
      kind: "edit",
      description:
        "Remove steps that aren't part of the task (a click that changed nothing, a detour), with why: the user sees it",
      input: z.object({
        steps: z.union([z.string(), z.array(z.string())]).transform((s) => (Array.isArray(s) ? s : [s])),
        why: Why,
      }),
      prepare: unstring,
      run: ({ steps, why }) => {
        const missing = steps.find((s) => !known(s));
        if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
        return apply(
          steps.map((s): EditInput => ({ op: "remove", step: s })),
          why,
          steps,
        );
      },
    }),
    tool({
      name: "restore",
      kind: "edit",
      description: "Put back a step code left out as noise (the list is in your first message), with why",
      input: z.object({ step: z.string(), why: Why }),
      prepare: unstring,
      run: ({ step, why }) => {
        const gone = session.dropped.get(step);
        if (!gone)
          return {
            output: {
              ok: false,
              problems: [`no left-out step ${step}. Left out: ${[...session.dropped.keys()].join(", ") || "none"}`],
            },
          };
        const at = known(gone.after) ? { after: gone.after } : { after: lastTop() };
        const result = apply([{ op: "insert", at, step: gone.step as Record<string, unknown> }], why, [step]);
        if ((result.output as { ok: boolean }).ok) session.dropped.delete(step);
        return result;
      },
    }),
    tool({
      name: "add",
      kind: "edit",
      description:
        'Add any step: { do, intent, target?, values }. do: open, click, type, select, press, read, read_all, read_sheet, wait, upload, find_files, move_file, pick_row, open_app, press_in_app, type_in_app, menu (or channel.action). open takes page: a step that opened it or a tab name ("s1", "KPI Sheet"); code writes the address. target: { like: "s3" } for a control they used, or { role, name } for a new one (unverified until the test run finds it). Where: after, before or into',
      input: z.object({ step: StepSpec, ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }) => {
        for (const id of [after, before, into])
          if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        const id = nextId("s");
        const built = compile(step, id);
        if ("error" in built) return { output: { ok: false, problems: [built.error] } };
        return apply(
          [{ op: "insert", at: position({ after, before, into }), step: built.step }],
          why,
          [id],
          built.unverified ? [id] : [],
        );
      },
    }),
    tool({
      name: "change",
      kind: "edit",
      description:
        'Change a step: its intent, its values (args, merged; e.g. { text: "{{today}}" }), the page it opens (page: a step or tab name), its control (target: { like } or { role, name }), its tab, its check or wait, or save_as (its result becomes a variable)',
      input: z.object({
        step: z.string(),
        intent: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        target: TargetSpec.optional(),
        tab: z.string().optional(),
        check: z.record(z.string(), z.unknown()).optional(),
        wait: z.record(z.string(), z.unknown()).optional(),
        save_as: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        page: z.string().optional(),
        why: Why,
      }),
      prepare: unstring,
      run: ({ step: id, intent, args: given, target, tab, check, wait, save_as, page, why }) => {
        const url = page === undefined ? undefined : session.pages.get(page);
        if (page !== undefined && !url) {
          return {
            output: {
              ok: false,
              problems: [`no page ${page}. Pages: ${[...session.pages.keys()].join(", ") || "none"}`],
            },
          };
        }
        const args = url ? { ...(given ?? {}), url } : given;
        const step = anyStep(id);
        if (!step || !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        const edits: EditInput[] = [];
        let unverified = false;
        if (intent) edits.push({ op: "set", step: id, field: "intent", value: intent });
        if (!isAction(step) && (args || target || tab || check || wait || save_as)) {
          return {
            output: {
              ok: false,
              problems: [`${id} is a ${step.type} step: only actions have values, a control, a tab or checks`],
            },
          };
        }
        if (isAction(step)) {
          if (args) edits.push({ op: "set", step: id, field: "args", value: { ...step.args, ...args } });
          if (check) edits.push({ op: "set", step: id, field: "check", value: check });
          if (wait) edits.push({ op: "set", step: id, field: "wait", value: wait });
          if (save_as)
            edits.push({
              op: "set",
              step: id,
              field: "output",
              value: {
                name: save_as,
                type: producedType({ ...step, args: { ...step.args, ...(args ?? {}) } } as never),
              },
            });
          if (target) {
            if ("like" in target) {
              const like = anyStep(target.like);
              if (!like || !isAction(like) || !like.target)
                return { output: { ok: false, problems: [`${target.like} has no control to copy`] } };
              edits.push({ op: "retarget", step: id, target: like.target });
            } else {
              edits.push({ op: "retarget", step: id, target: { ...target, fallbacks: [] } });
              unverified = true;
            }
          }
          if (tab)
            edits.push({
              op: "replace",
              step: id,
              with: { ...step, ...(args ? { args: { ...step.args, ...args } } : {}), tab } as never,
            });
        }
        if (edits.length === 0)
          return {
            output: {
              ok: false,
              problems: ["say what to change: intent, args, page, target, tab, check, wait or save_as"],
            },
          };
        return apply(edits, why, [id], unverified ? [id] : []);
      },
    }),
    tool({
      name: "move",
      kind: "edit",
      description: "Move a step (with what is inside it): after, before or into a loop or branch",
      input: z.object({ step: z.string(), ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }) => {
        for (const id of [step, after, before, into])
          if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        return apply([{ op: "move", step, to: position({ after, before, into }) }], why, [step]);
      },
    }),
    loop,
    branch,
    aiStep,
    tool({
      name: "trigger",
      kind: "edit",
      description:
        'How often it runs: "manual", { schedule: "0 9 * * *" } (a cron in the Mac\'s time), or { folder: "~/Downloads", glob: "*.pdf" }',
      input: z.object({
        when: z.union([
          z.literal("manual"),
          z.object({ schedule: z.string() }),
          z.object({ folder: z.string(), glob: z.string().optional() }),
        ]),
        why: Why,
      }),
      prepare: unstring,
      run: ({ when, why }) => {
        const value =
          when === "manual"
            ? [{ type: "manual" }]
            : "schedule" in when
              ? [{ type: "schedule", cron: when.schedule }]
              : [{ type: "folder_watch", dir: when.folder, ...(when.glob ? { glob: when.glob } : {}) }];
        return apply([{ op: "set", step: "start", field: "when", value }], why, ["start"]);
      },
    }),
    tool({
      name: "input",
      kind: "edit",
      description:
        "A value the run starts with (one that changes each time and no step can read): its name, type, a default and what it is",
      input: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/),
        type: z.enum(["text", "number", "date", "boolean", "file"]),
        default: z.unknown().optional(),
        about: z.string().min(1),
        why: Why,
      }),
      prepare: unstring,
      run: ({ name, type, default: value, about, why }) => {
        const inputs = {
          ...triggerOf(session.draft).inputs,
          [name]: { type: { type }, description: about, ...(value !== undefined ? { default: value } : {}) },
        };
        return apply([{ op: "set", step: "start", field: "inputs", value: inputs }], why, ["start"]);
      },
    }),
    tool({
      name: "look",
      kind: "look",
      description:
        "A step's full evidence (step), a proposal (proposal), the timeline between two steps (from, to), or the workflow as it is now (nothing)",
      input: z.object({
        step: z.string().optional(),
        proposal: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      prepare: unstring,
      run: ({ step, proposal, from, to }) => {
        if (proposal) return { output: session.proposals.get(proposal) ?? `no proposal ${proposal}` };
        if (step) return { output: session.evidence?.step(step) ?? anyStep(step) ?? unknown(step), untrusted: true };
        if (from || to) return { output: session.evidence?.timeline(from, to) ?? "no timeline", untrusted: true };
        return { output: outlineOf(session.draft) };
      },
    }),
    ask,
    tool({
      name: "test",
      kind: "look",
      description:
        "Test the workflow in the automation window, safely: it opens pages and reads, and only outlines what would type, send or change something. Returns what it did, found, couldn't find, and why",
      input: z.object({}),
      run: async () => ({ output: await test() }),
    }),
    done,
  ];

  // The old names the model reaches for (Oct 19: wrap_in_branch sent as an edit op, wrap_in_loop never found).
  const alias = (name: string, to: AnyTool<DoneReport>): AnyTool<DoneReport> => ({
    ...to,
    name,
    description: `Same as ${to.name}. ${to.description}`,
  });
  tools.push(
    alias("wrap_in_loop", loop),
    alias("wrap_in_branch", branch),
    alias("add_llm_step", aiStep),
    alias("ask_user", ask),
    alias("finish", done),
    tool({
      name: "edit",
      kind: "look",
      description: "Not a tool any more: says which tools change the workflow",
      input: z.record(z.string(), z.unknown()),
      run: () => ({
        output: {
          use: "add, change, remove, move, loop, branch, ai_step, trigger, input (several calls per turn are fine)",
        },
      }),
    }),
  );
  // Every result the model reads is masked like the evidence: the outline, a step's record and a proposal's prepared
  // change hold recorded values (an email typed, a key copied, a Never or private word).
  const hide = (value: unknown): unknown =>
    typeof value === "string"
      ? maskText(value, session.maskTerms ?? []).text
      : Array.isArray(value)
        ? value.map(hide)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hide(v)]))
          : value;
  return tools.map((t) => ({
    ...t,
    run: async (input: unknown, ctx: ToolContext) => {
      const result = await t.run(input, ctx);
      return { ...result, output: hide(result.output) };
    },
  }));
}
