// prompts.spec.ts — structural guarantees about the prompts and tool schemas.
//
// You cannot unit-test whether a prompt works. You can test that the pieces
// which must be present are present — and every check here corresponds to
// something that was once missing, or that would fail silently if it went
// missing tomorrow. A prompt regression is invisible until someone reads a
// transcript, which is the argument for pinning its structure.
import { suite, assert, assertEq, assertIncludes, assertExcludes } from "../lib/harness.ts";
import { MODALITIES, modalityPrompt, isModalityId, DEFAULT_MODALITY,
         type ModalityId } from "../../mentor-agent/modalities.ts";
import { TOOLS, toolsFor } from "../../mentor-agent/tools.ts";
import { OPERATING_NOTE, SYSTEM_PROMPT } from "../../mentor-agent/mentor.ts";

const ids = Object.keys(MODALITIES) as ModalityId[];

const distortionDesc = (tools: typeof TOOLS): string => {
  const t = tools.find((x) => x.function.name === "flag_limiting_belief");
  return String((t!.function.parameters as any).properties.distortion.description);
};

export default suite({
  name: "prompts",
  kind: "spec",
  about: "stances, safety boundary, per-lens tool vocabulary",
  cases: [
    {
      name: "every stance carries the safety boundary",
      tags: ["safety"],
      run: () => {
        for (const id of ids) {
          const p = modalityPrompt(id);
          assertIncludes(p, "not a licensed therapist", `${id} states it is not a therapist`);
          assertIncludes(p, "never diagnose", `${id} refuses to diagnose`);
          assertIncludes(p, "crisis", `${id} names the crisis case`);
          // The precedence matters as much as the content: a boundary that
          // does not outrank the technique is a suggestion.
          assertIncludes(p, "overrides everything else", `${id} makes the boundary outrank the stance`);
        }
      },
    },
    {
      name: "ISTDP subordinates its own pressure to the person's tolerance",
      tags: ["safety"],
      run: () => {
        // This stance deliberately raises anxiety, so its internal stop rule
        // has to be explicitly ranked above the rules that apply pressure.
        assertIncludes(MODALITIES.istdp.prompt, "This rule outranks rules 1-3",
          "the de-escalation rule must explicitly outrank the pressure rules");
      },
    },
    {
      name: "the original CBT prompt is preserved verbatim",
      tags: ["regression"],
      run: () => {
        // The four numbered rules are the product owner's text. Everything the
        // engineer added lives in OPERATING_NOTE, appended after them, so it
        // stays obvious which lines exist because someone asked for them.
        assertEq(SYSTEM_PROMPT, MODALITIES.cbt.prompt, "CBT is the original prompt");
        for (const rule of ["NEVER blindly agree", "DO NOT give easy answers",
                            "ALWAYS hold the user accountable", "Dynamically invoke tools"]) {
          assertIncludes(SYSTEM_PROMPT, rule, `rule preserved: ${rule}`);
        }
        assertExcludes(SYSTEM_PROMPT, "RUN THIS CHECK", "the operating note is not merged into it");
      },
    },
    {
      name: "the operating note still contains the pre-reply tool check",
      tags: ["regression", "tools"],
      run: () => {
        // Removed once by accident and the tools stopped firing; diluted once
        // by longer stance prompts and they stopped firing again.
        assertIncludes(OPERATING_NOTE, "RUN THIS CHECK BEFORE EVERY REPLY", "the checklist survives");
        assertIncludes(OPERATING_NOTE, "record_goal", "names the goal tool");
        assertIncludes(OPERATING_NOTE, "flag_limiting_belief", "names the flag tool");
        assertIncludes(OPERATING_NOTE, "update_goal", "names the settling tool");
        assertIncludes(OPERATING_NOTE, "WHEN YOU LOOK SOMETHING UP, AND WHEN YOU MUST NOT",
          "search is fenced in the operating note, not only in the tool schema");
        assertIncludes(OPERATING_NOTE, "reading list",
          "and specifically banned from replacing the question it owes them");
        assertIncludes(OPERATING_NOTE, "Never narrate your own method", "bans meta-narration");
      },
    },
    {
      name: "each lens is given only its own vocabulary",
      tags: ["panel", "regression"],
      run: () => {
        // The shipped failure: the CBT chair read the shared description, which
        // lists all four traditions, and logged "negative reinforcement of
        // avoidance" — the behaviourist's word. The record stopped being
        // attributable to whoever saw it.
        const signature: Record<ModalityId, string> = {
          cbt: "catastrophizing",
          istdp: "intellectualizing",
          analytical: "shadow",
          behavioral: "extinction burst",
        };
        for (const id of ids) {
          const desc = distortionDesc(toolsFor(id, MODALITIES[id].vocabulary));
          assertIncludes(desc, signature[id], `${id} keeps its own vocabulary`);
          for (const other of ids) {
            if (other === id) continue;
            assertExcludes(desc, signature[other], `${id} is not offered ${other}'s vocabulary`);
          }
        }
      },
    },
    {
      name: "narrowing the vocabulary leaves the other tools untouched",
      tags: ["panel"],
      run: () => {
        const narrowed = toolsFor("cbt", MODALITIES.cbt.vocabulary);
        assertEq(narrowed.length, TOOLS.length, "same number of tools");
        assertEq(narrowed.map((t) => t.function.name).join(","),
                 TOOLS.map((t) => t.function.name).join(","), "same tools, same order");
        // The narrowing must not have mutated the shared definition.
        assertIncludes(distortionDesc(TOOLS), "extinction burst",
          "the shared TOOLS array is not modified in place");
      },
    },
    {
      name: "the five tools are declared with the fields the app relies on",
      tags: ["tools"],
      run: () => {
        const byName = Object.fromEntries(TOOLS.map((t) => [t.function.name, t]));
        for (const n of ["record_goal", "update_goal", "flag_limiting_belief",
                         "web_search", "find_support"]) {
          assert(byName[n], `tool declared: ${n}`);
        }
        const status = (byName.update_goal!.function.parameters as any).properties.status;
        assertEq(status.enum.join(","), "kept,missed,dropped", "status is a closed set");

        // web_search requires a justification it never reads. Making the model
        // state why it needs the lookup suppresses lookups it cannot justify.
        const search = (byName.web_search!.function.parameters as any);
        assert(search.required.includes("why"), "web_search must require a stated reason");
        assertIncludes(String(byName.web_search!.function.description), "NOT for advice",
          "the search tool is fenced in its own description");
      },
    },
    {
      name: "find_support does not let the model write the query",
      tags: ["safety"],
      run: () => {
        // A general search with a model-written query, reached for in a crisis,
        // is a different and much worse tool. It takes `need` and `location`;
        // the query itself is built in code.
        const params = (TOOLS.find((t) => t.function.name === "find_support")!
          .function.parameters as any);
        const keys = Object.keys(params.properties).sort().join(",");
        assertEq(keys, "location,need", "find_support exposes no free-form query");
      },
    },
    {
      name: "every lens is complete and distinct",
      tags: ["config"],
      run: () => {
        const names = new Set<string>();
        for (const id of ids) {
          const m = MODALITIES[id];
          assertEq(m.id, id, "id matches its key");
          for (const field of ["name", "blurb", "panelName", "flagLabel", "vocabulary", "prompt"] as const) {
            assert(m[field] && String(m[field]).trim().length > 0, `${id}.${field} is set`);
          }
          assert(!names.has(m.panelName), `panel name is unique: ${m.panelName}`);
          names.add(m.panelName);
          assert(isModalityId(id), `${id} passes its own type guard`);
        }
        assert(isModalityId(DEFAULT_MODALITY), "the default is a real lens");
        assert(!isModalityId("gestalt"), "the guard rejects unknown lenses");
        assert(!isModalityId(undefined), "and undefined, which is what env vars give you");
      },
    },
  ],
});
