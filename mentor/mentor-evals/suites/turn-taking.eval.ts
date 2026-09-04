// turn-taking.eval.ts — the bidding model's judgement, on its own.
//
// room-rules.spec.ts covers the arithmetic the room applies to a bid. This
// covers the part the arithmetic cannot: whether the model's raw urge tracks
// the situation at all. Both halves have to work — perfect rules applied to
// random urges is still a random room.
//
// These use pollBids(), so a whole turn-taking decision costs four small calls
// instead of four full turns from the big model. Watching a decision through
// run() would be roughly twenty times the price for the same information.
import { suite, assert } from "../lib/harness.ts";
import { roomWith, said } from "../lib/fixtures.ts";

const THRESHOLD = 50;

export default suite({
  name: "turn taking",
  kind: "eval",
  about: "who wants the floor, and who correctly does not",
  cases: [
    {
      name: "somebody speaks when the person opens with real material",
      tags: ["turn-taking"],
      run: async () => {
        const bids = await roomWith([
          said("user", "I promised my partner I'd stop working past nine. I've broken it every " +
                       "night for two weeks and I keep telling her it's just this one project."),
        ]).pollBids();
        assert(bids[0].score >= THRESHOLD,
          `nobody took an obvious opening: ${bids.map((b) => `${b.name}:${b.score}`).join(" ")}`);
      },
    },
    {
      name: "the room holds back while a question to the person is unanswered",
      tags: ["turn-taking", "negative"],
      run: async () => {
        // The failure this prevents: four clinicians stacking four questions.
        const bids = await roomWith([
          said("user", "I keep putting off the chapter."),
          said("behavioral", "What was happening in the ten minutes before you decided not to open it?"),
        ]).pollBids();
        assert(bids[0].score < THRESHOLD,
          `talked over an unanswered question: ${bids.map((b) => `${b.name}:${b.score}`).join(" ")}`);
      },
    },
    {
      name: "being named by a colleague wins the floor",
      tags: ["turn-taking"],
      run: async () => {
        const bids = await roomWith([
          said("user", "I just can't get started in the mornings."),
          said("behavioral",
               "Marek, you'll want to make this about feeling, but the cue is the phone on the " +
               "bedside table. That's what needs moving."),
        ]).pollBids();
        assert(bids[0].id === "istdp",
          `Marek was addressed by name and did not get the floor: ` +
          bids.map((b) => `${b.name}:${b.score}`).join(" "));
      },
    },
    {
      name: "the speaker who just spoke does not go twice",
      tags: ["turn-taking", "negative"],
      run: async () => {
        // The last turn is a STATEMENT on purpose. An earlier version of this
        // case ended on a question, which meant every bid was floored to 0 by
        // the open-question rule and "who sorted first" among four ties decided
        // the result. The case was measuring tie-break order, not the rule it
        // named. Isolate one rule per case.
        const bids = await roomWith([
          said("user", "I avoid opening my email for days at a time."),
          said("cbt", "You've called that laziness before, and it hasn't moved you an inch."),
        ]).pollBids();
        const winner = bids[0];
        assert(winner.score < THRESHOLD || winner.id !== "cbt",
          `the same voice took the floor twice: ${bids.map((b) => `${b.name}:${b.score}`).join(" ")}`);
      },
    },
    {
      name: "the lens the material belongs to wants the floor",
      tags: ["turn-taking"],
      run: async () => {
        // A recurring dream is Sylvia's material. It is NOT only hers — the
        // "oddly calm" is a defense Marek would go for, and the belief behind
        // it is Iris's. An earlier version of this case demanded that Sylvia
        // strictly win, and it flapped, because it encoded the author's taste
        // rather than anything the system promises. What the system does
        // promise is that the lens the material belongs to is in the running.
        const bids = await roomWith([
          said("user", "The same dream keeps coming back. I'm handed an exam paper and every " +
                       "page is blank, and I feel oddly calm about it."),
        ]).pollBids();
        const sylvia = bids.find((b) => b.id === "analytical")!;
        const rank = bids.findIndex((b) => b.id === "analytical");
        assert(sylvia.score >= THRESHOLD && rank <= 1,
          `the lens that owns this material was not in contention (rank ${rank + 1}): ` +
          bids.map((b) => `${b.name}:${b.score}`).join(" "));
      },
    },
  ],
});
