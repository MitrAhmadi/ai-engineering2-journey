// room-rules.spec.ts — the three rules the room enforces in code.
//
// These are the highest-value tests in the project, and the reason is in the
// build history: all three were written in the bidding prompt first, in plain
// English, and the model ignored them. They were moved into code because a rule
// belongs somewhere it cannot be talked out of. That makes them exactly the
// kind of thing that must not regress silently — and, being pure arithmetic,
// they cost nothing to check.
import { suite, assert, assertEq } from "../lib/harness.ts";
import { said } from "../lib/fixtures.ts";
import { applyRoomRules, endsOnOpenQuestion, addressesMember } from "../../mentor-agent/panel.ts";

const THRESHOLD = 50;          // FLOOR_THRESHOLD in panel.ts

export default suite({
  name: "room rules",
  kind: "spec",
  about: "floor bidding: monologue, open questions, being named",
  cases: [
    {
      name: "the last speaker is heavily penalised",
      tags: ["turn-taking"],
      run: () => {
        const last = said("cbt", "What is the evidence for that.");
        // Without this, one voice takes the room and never gives it back.
        assertEq(applyRoomRules(80, "cbt", last), 40, "40 off for having just spoken");
        assertEq(applyRoomRules(80, "istdp", last), 80, "nobody else is penalised");
      },
    },
    {
      name: "an unanswered question to the person costs the floor",
      tags: ["turn-taking"],
      run: () => {
        const asked = said("cbt", "What kept you from sending the chapter?");
        // The failure this prevents: four clinicians stacking four questions
        // and the person never getting to answer any of them.
        assert(applyRoomRules(80, "istdp", asked) < THRESHOLD,
          "a strong-but-ordinary urge must not talk over an open question");
        assert(applyRoomRules(95, "istdp", asked) >= THRESHOLD,
          "but a genuinely urgent claim still gets through");
      },
    },
    {
      name: "the penalty lifts once the person has answered",
      tags: ["turn-taking"],
      run: () => {
        const answered = said("user", "I don't know. I just didn't open it.");
        assertEq(applyRoomRules(60, "istdp", answered), 60, "no penalty after the person speaks");
      },
    },
    {
      name: "an interrupted question is not an open question",
      tags: ["turn-taking", "negative"],
      run: () => {
        // They cut the speaker off mid-question — the question was never
        // really asked, and holding the room silent for it would be absurd.
        const cut = said("cbt", "And what did that get you?", { interrupted: true });
        assertEq(applyRoomRules(60, "istdp", cut), 60, "a cut-off question does not hold the floor");
      },
    },
    {
      name: "being named by the last speaker is a claim on the floor",
      tags: ["turn-taking"],
      run: () => {
        const named = said("behavioral", "Marek, that is a story, and it costs them the morning.");
        assertEq(applyRoomRules(45, "istdp", named), 65, "+20 for being addressed");
        assert(applyRoomRules(45, "istdp", named) >= THRESHOLD,
          "'Marek, I disagree' has to actually reach Marek");
        assertEq(applyRoomRules(45, "analytical", named), 45, "and nobody else");
      },
    },
    {
      name: "penalties and bonuses combine, and stay in range",
      tags: ["turn-taking"],
      run: () => {
        // Named, but you also just spoke, and you left a question hanging.
        const mine = said("istdp", "Marek, so what do you feel right now?");
        assertEq(applyRoomRules(100, "istdp", mine), 25, "100 − 40 (just spoke) − 35 (open question)");
        assertEq(applyRoomRules(10, "cbt", said("cbt", "hm.")), 0, "never negative");
        assertEq(applyRoomRules(100, "cbt", said("user", "Iris, help")), 100, "never above 100");
      },
    },
    {
      name: "open-question detection survives real punctuation",
      tags: ["turn-taking"],
      run: () => {
        const open = [
          "What do you feel?",
          "What do you feel? ",
          'Is it "enough"?"',
          "Was it worth it?)",
        ];
        for (const t of open) assert(endsOnOpenQuestion(said("cbt", t)), `should be open: ${t}`);

        const closed = [
          "Tell me what you feel.",
          "You asked yourself why? Then you stopped.",   // question mid-sentence
          "Notice the defense.",
        ];
        for (const t of closed) assert(!endsOnOpenQuestion(said("cbt", t)), `should not be open: ${t}`);
      },
    },
    {
      name: "the person's own question does not silence the room",
      tags: ["turn-taking", "negative"],
      run: () => {
        // If THEY ask something, the room should answer it, not hold back.
        assert(!endsOnOpenQuestion(said("user", "so what do I actually do?")),
          "an open question belongs to the person only when a clinician asked it");
      },
    },
    {
      name: "names match on word boundaries",
      tags: ["turn-taking"],
      run: () => {
        assert(addressesMember("Marek, I disagree.", "istdp"), "plain address");
        assert(addressesMember("I think marek is right", "istdp"), "case insensitive");
        assert(!addressesMember("Marekson wrote about this", "istdp"), "not a substring of another word");
        assert(!addressesMember("Iris is right", "istdp"), "someone else's name");
      },
    },
  ],
});
