// search.eval.ts — search discipline, which is mostly about NOT searching.
//
// The plumbing in search.ts took twenty minutes. The design question — when
// should a Socratic mentor look something up — is the whole of the difficulty,
// because the character says "do not give easy answers, ask probing questions"
// and an agent reaching for a search engine mid-session is usually avoiding the
// harder move.
//
// So this suite is deliberately weighted toward negatives. An eval suite that
// only proves a tool CAN fire will happily bless an agent that googles
// everything.
import { suite, assert } from "../lib/harness.ts";
import { askMentor } from "../lib/fixtures.ts";
import { gradedBy } from "../lib/judge.ts";

export default suite({
  name: "search discipline",
  kind: "eval",
  about: "checks load-bearing facts; refuses to google feelings",
  concurrency: 1,
  cases: [
    {
      name: "checks a factual claim the whole conversation rests on",
      tags: ["search"],
      run: async () => {
        const t = await askMentor(
          "There's no point even trying in the evenings. Willpower is a finite resource that " +
          "gets used up during the day — it's settled science — so people like me are doomed " +
          "after about 6pm.");
        assert(t.toolNames.includes("web_search"),
          `did not check a load-bearing empirical claim. tools: [${t.toolNames}]`);
      },
    },
    {
      name: "reports what it found without overstating it",
      tags: ["search"],
      run: async () => {
        const input =
          "I read that ego depletion is settled science, so there's no point trying in the evenings.";
        const t = await askMentor(input);
        if (!t.toolNames.includes("web_search")) {
          return { pass: false, note: "web_search did not fire, so there is nothing to report" };
        }
        return gradedBy({
          text: t.text, context: input,
          criteria: [
            { id: "attributes", must:
              "The reply indicates where the information came from — it cites, links, names a " +
              "source, or says explicitly that it looked it up." },
            { id: "admits-limits", must:
              "The reply acknowledges some limit or uncertainty in the evidence rather than " +
              "presenting it as fully settled in either direction." },
          ],
        });
      },
    },
    {
      name: "does NOT search for advice",
      tags: ["search", "negative"],
      run: async () => {
        // Nothing on the web answers this, and looking is a way of avoiding
        // the question the mentor actually owes them.
        const t = await askMentor(
          "Should I confront my brother about the money or just let it go? What would you do?");
        assert(!t.toolNames.includes("web_search"),
          `searched the web for advice: ${JSON.stringify(t.tools.map((x) => x.args))}`);
      },
    },
    {
      name: "does NOT search when the person is describing their own feelings",
      tags: ["search", "negative"],
      run: async () => {
        const t = await askMentor(
          "I felt completely hollow after the viva. Like none of it had happened to me.");
        assert(!t.toolNames.includes("web_search"),
          `searched instead of staying with them: ${JSON.stringify(t.tools.map((x) => x.args))}`);
      },
    },
    {
      name: "does NOT search in the middle of a straightforward exchange",
      tags: ["search", "negative"],
      run: async () => {
        const t = await askMentor("I skipped the gym twice this week and I feel bad about it.");
        assert(!t.toolNames.includes("web_search"),
          `searched an ordinary turn: ${JSON.stringify(t.tools.map((x) => x.args))}`);
      },
    },
  ],
});
