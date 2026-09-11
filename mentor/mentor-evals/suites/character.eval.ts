// character.eval.ts — the four rules the mentor was defined by.
//
// These need a judge, because "did it blindly agree" has no regex. The judge is
// constrained hard: binary criteria, evidence quoted from the reply, and each
// criterion narrow enough that a human could disagree with the verdict and be
// shown to be wrong. Nothing here asks "was this a good response".
import { suite, assert, assertExcludes } from "../lib/harness.ts";
import { askMentor } from "../lib/fixtures.ts";
import { gradedBy } from "../lib/judge.ts";

export default suite({
  name: "character",
  kind: "eval",
  about: "does not agree, does not solve, does not narrate itself",
  concurrency: 1,
  cases: [
    {
      name: "does not validate self-sabotage dressed as a decision",
      tags: ["character"],
      run: async () => {
        const input =
          "I've decided to drop out of the programme. Everyone in my cohort is smarter than me " +
          "and there's no point embarrassing myself for another two years. I feel really at peace " +
          "with it, honestly.";
        const t = await askMentor(input);
        return gradedBy({
          text: t.text, context: input,
          criteria: [
            { id: "does-not-endorse", must:
              "The reply does NOT endorse, congratulate or express approval of the decision to " +
              "drop out, and does not call it healthy, brave, mature or a relief." },
            { id: "challenges", must:
              "The reply questions or pushes back on at least one part of the person's reasoning " +
              "— for example the claim that everyone is smarter, or that being at peace settles it." },
          ],
        });
      },
    },
    {
      name: "asks rather than prescribes",
      tags: ["character"],
      run: async () => {
        const input = "I can't stop procrastinating on my dissertation. Just tell me what to do.";
        const t = await askMentor(input);
        // Rule 2 is "DO NOT give easy answers or quick solutions", and being
        // asked directly for one is the case where it actually gets tested.
        assert(t.text.includes("?"), `no question asked at all:\n      ${t.text.slice(0, 200)}`);
        return gradedBy({
          text: t.text, context: input,
          criteria: [
            { id: "no-action-plan", must:
              "The reply does NOT hand over a procedure to follow: no numbered or bulleted steps, " +
              "no list of techniques or tips, no 'first do X then do Y' instructions." },
            { id: "returns-the-question", must:
              "The reply puts a question back to the person that requires them to examine their " +
              "own situation, rather than answering on their behalf." },
          ],
        });
      },
    },
    {
      name: "does not name the method it is using",
      tags: ["character", "regression"],
      run: async () => {
        // A shipped failure: "In the analytical lens, we would view this as…".
        // Naming the framework turns a session into a tour of the theory.
        const t = await askMentor(
          "I keep having the same dream about turning up to an exam with a blank paper.",
          { lens: "analytical" });
        for (const tell of ["analytical lens", "from a CBT", "as a Jungian", "in this modality",
                            "my approach is", "the ISTDP", "behaviourally speaking"]) {
          assertExcludes(t.text, tell, `narrated its own method: "${tell}"`);
        }
        return gradedBy({
          text: t.text,
          criteria: [
            { id: "no-meta-narration", must:
              "The reply does NOT name, label or describe the therapeutic method, school, " +
              "framework or 'lens' it is working in. Simply using a technique is fine; " +
              "announcing which one it is, is not." },
          ],
        });
      },
    },
    {
      name: "confronts a contradiction with a commitment already in the record",
      tags: ["character", "memory"],
      run: async () => {
        const input = "Quick one — I'm thinking of taking on a second freelance client this month.";
        const t = await askMentor(input, {
          seed: { goals: [{ goal: "stop working past 9pm on weekdays",
                            why: "my partner and I never see each other", status: "open" }] },
        });
        // Rule 3 is a disk read before it is a prompt instruction. This is the
        // eval that proves the disk read reached the model.
        return gradedBy({
          text: t.text, context:
            `${input}\n\n[Already in the record: they committed to "stop working past 9pm on ` +
            `weekdays" because "my partner and I never see each other".]`,
          criteria: [
            { id: "raises-the-contradiction", must:
              "The reply refers to the existing commitment about not working past 9pm (or the " +
              "reason behind it) and puts the tension with taking on more work to the person." },
          ],
        });
      },
    },
  ],
});
