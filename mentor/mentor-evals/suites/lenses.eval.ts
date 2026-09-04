// lenses.eval.ts — are the four stances actually four stances?
//
// This is the eval for the central claim of the whole feature: that these are
// four theories of why a person is stuck, not four tones of voice. It is easy
// to write four prompts that differ only in politeness and believe you have
// built something. The test is whether an independent reader, given only the
// replies, can tell which theory produced which.
//
// It is graded as a discrimination task rather than four yes/no criteria,
// because a judge asked "is this CBT?" about four similar replies will happily
// say yes four times.
import { suite, assert } from "../lib/harness.ts";
import { askMentor } from "../lib/fixtures.ts";
import { classify } from "../lib/judge.ts";
import { MODALITIES, type ModalityId } from "../../mentor-agent/modalities.ts";

const LENSES: ModalityId[] = ["cbt", "istdp", "analytical", "behavioral"];

// Deliberately ambiguous material: it offers a thought to test, a feeling to
// press, an image to amplify and a contingency to analyse. If the stances only
// differ when the input hands them their own speciality, they do not differ.
const INPUT =
  "I've been putting off calling my mother for about three months now. Every Sunday I tell " +
  "myself I'll do it, and then I find something else. Last week I actually picked up the " +
  "phone and put it straight back down. I keep thinking she'll hear it in my voice and know " +
  "I've been avoiding her.";

const LABELS = [
  { id: "cbt", description:
    "Treats a distorted THOUGHT as the problem. Asks for evidence for or against a belief, " +
    "tests a prediction, looks for the assumption underneath." },
  { id: "istdp", description:
    "Treats a defended-against FEELING as the problem. Asks what they feel right now, in the " +
    "body, and names avoidance happening in this exchange as it happens." },
  { id: "analytical", description:
    "Treats the symptom as MEANINGFUL. Stays with an image, dream or fantasy, looks for what " +
    "is disowned or projected, resists explaining the symptom away." },
  { id: "behavioral", description:
    "Treats the CONTINGENCIES as the problem. Asks what happened right before and right after, " +
    "what the avoidance is earning, and changes cues or step size." },
];

export default suite({
  name: "lenses",
  kind: "eval",
  about: "four theories, not four tones of voice",
  concurrency: 1,
  cases: [
    {
      // TRACKED, NOT GATED. ISTDP, Analytical and Behavioral are identified
      // correctly every time. CBT is not: it gets read as analytical or
      // behavioral, because its replies tend toward generic empathic
      // reflection rather than testing a belief against evidence.
      //
      // The cause is visible in modalities.ts. The other three stances open
      // with a "YOUR MODEL OF THE PERSON" section and a named set of things
      // they work with. CBT has neither — it is the original prompt, four
      // numbered rules, preserved verbatim on purpose, and prompts.spec.ts
      // asserts that it stays that way.
      //
      // Closing this means giving CBT the same scaffolding as its siblings,
      // appended after the original text the way OPERATING_NOTE is. That is a
      // product decision about someone else's prompt, so it is measured and
      // documented rather than quietly patched.
      //
      // Measured at 7 of 9 samples when this was written, with every failure
      // being CBT and no other stance ever misread. That is high enough to be
      // worth keeping and unstable enough that any gate would flap and teach
      // everyone to re-run until green. So it is a number to watch, not a gate.
      // Re-measure with:
      //   npm run eval -- --only "all four stances" --runs 10
      name: "an independent reader can tell all four stances apart",
      tags: ["lenses", "tracked"],
      gate: false,
      runs: 4,
      run: async () => {
        const replies = await Promise.all(
          LENSES.map(async (lens) => ({ lens, text: (await askMentor(INPUT, { lens })).text })),
        );

        for (const r of replies) {
          assert(r.text.trim().length > 0, `${r.lens} produced nothing`);
        }

        const got = await classify({
          what: "Each item is a therapist's reply to the same person. Which tradition is each " +
                "working in?",
          labels: LABELS,
          items: replies.map((r, i) => ({ id: String.fromCharCode(65 + i), text: r.text })),
        });

        const wrong = replies
          .map((r, i) => ({ lens: r.lens, guess: got[String.fromCharCode(65 + i)] }))
          .filter((x) => x.guess !== x.lens);

        return {
          pass: wrong.length === 0,
          note: wrong.length
            ? `misread: ${wrong.map((w) => `${MODALITIES[w.lens].name}→${w.guess ?? "?"}`).join(", ")}`
            : undefined,
          detail: wrong.length
            ? replies.map((r) => `  [${r.lens}] ${r.text.slice(0, 220).replace(/\n/g, " ")}`).join("\n")
            : undefined,
        };
      },
    },
    {
      name: "the three fully-specified stances are unmistakable",
      tags: ["lenses"],
      runs: 2,
      run: async () => {
        // The same measurement as above, minus the stance we know is weak.
        // Keeping this separate means the suite still protects the three that
        // do work — deleting the whole case because one quarter of it fails
        // would throw away a real guarantee.
        const specified: ModalityId[] = ["istdp", "analytical", "behavioral"];
        const replies = await Promise.all(
          specified.map(async (lens) => ({ lens, text: (await askMentor(INPUT, { lens })).text })),
        );
        const got = await classify({
          what: "Each item is a therapist's reply to the same person. Which tradition is each " +
                "working in?",
          labels: LABELS,
          items: replies.map((r, i) => ({ id: String.fromCharCode(65 + i), text: r.text })),
        });
        const wrong = replies
          .map((r, i) => ({ lens: r.lens, guess: got[String.fromCharCode(65 + i)] }))
          .filter((x) => x.guess !== x.lens);
        return {
          pass: wrong.length === 0,
          note: wrong.length
            ? `misread: ${wrong.map((w) => `${MODALITIES[w.lens].name}→${w.guess ?? "?"}`).join(", ")}`
            : undefined,
          detail: wrong.length
            ? replies.map((r) => `  [${r.lens}] ${r.text.slice(0, 220).replace(/\n/g, " ")}`).join("\n")
            : undefined,
        };
      },
    },
    {
      name: "ISTDP goes to the body",
      tags: ["lenses"],
      run: async () => {
        // A cheap, deterministic cross-check on the expensive judged case
        // above. If this fails while that one passes, suspect the judge.
        //
        // Only ISTDP is checked this way, and that is a deliberate limit. Its
        // signature move has a genuinely lexical form: it asks about the body,
        // so it says body words. CBT's does not — an earlier version of this
        // case demanded /evidence|proof|how do you know/ and failed on "what
        // do you think she would hear?", which is textbook Socratic
        // questioning that simply avoids those words. A regex that tests for a
        // therapeutic MOVE rather than a WORD is measuring vocabulary and
        // calling it behaviour. That job belongs to the classifier above.
        const istdp = await askMentor(INPUT, { lens: "istdp" });
        const bodily = /\b(body|chest|throat|stomach|shoulders|jaw|physically|sensation|breath)\b/i;
        assert(bodily.test(istdp.text),
          `ISTDP never went to the body:\n      ${istdp.text.slice(0, 240)}`);
      },
    },
  ],
});
