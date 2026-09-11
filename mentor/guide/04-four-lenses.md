# Session 4 — Four lenses

**You will build:** four different theories of why a person is stuck, switchable
mid-conversation without losing the conversation.

**Files created:** `modalities.ts`. **Files changed:** `mentor.ts`, `agent.ts`,
`tools.ts`.

---

## The idea

CBT is one theory. It says: the thought is distorted, so test it against
evidence. It is not the only one, and for some people it is the wrong one.

Give the mentor four:

| lens | why you are stuck | what it asks next |
|---|---|---|
| **CBT** | the thought is distorted | what is the evidence for that? |
| **ISTDP** | the feeling is defended against | what do you feel in your body, right now? |
| **Analytical** | the symptom carries meaning | stay with the image — what else is in it? |
| **Behavioral** | the contingencies reward it | what did the avoidance get you? |

These are **not four tones of voice.** That distinction is the whole session. If
you write four prompts that differ in politeness you have built a personality
picker; if they differ in *what they believe causes the problem*, the next
question genuinely changes, and the same stuck story gets read four ways.

## 1. `modalities.ts`

```ts
// modalities.ts — four therapeutic stances the mentor can take.
//
// These are not four tones of voice. They are four different theories of why a
// person is stuck, and each one produces a different next question:
//
//   CBT         the thought is distorted        → test it against evidence
//   ISTDP       the feeling is defended against → block the defense, press for the feeling
//   Analytical  the symptom carries meaning     → stay with the image, don't explain it away
//   Behavioral  the contingencies reward it     → change the environment, not the mind
//
// Swapping the stance mid-conversation is the whole point of the dropdown: the
// same stuck story looks different under each lens.

export type ModalityId = "cbt" | "istdp" | "analytical" | "behavioral";

export interface Modality {
  id: ModalityId;
  name: string;
  /** One line for the dropdown. */
  blurb: string;
  /** What colleagues call them in the panel. A room needs names, not schools. */
  panelName: string;
  /** What this lens calls the thing flag_limiting_belief records. */
  flagLabel: string;
  /** The names this lens is allowed to use when it flags something. In the
   *  panel these keep each practitioner in their own language — a CBT
   *  clinician logging "negative reinforcement of avoidance" has borrowed the
   *  behaviourist's eyes, and the record stops meaning anything. */
  vocabulary: string;
  prompt: string;
}

// Applies to every modality. ISTDP in particular deliberately raises anxiety,
// so the boundary has to be explicit rather than assumed.
const SAFETY = `

BOUNDARY (applies always, overrides everything else):
You are not a licensed therapist and this is not therapy. You never diagnose.
If the person describes crisis, self-harm, abuse, substance dependence, or
anything that needs clinical care, drop the technique entirely — respond simply
and warmly, say plainly that this is beyond what you should handle, and point
them toward a professional or a crisis line. Getting that right matters more
than staying in character.`;

// The user's original prompt, unchanged. The other three are written to match
// its shape: same "uncompromising but empathetic" contract, different theory.
const CBT_PROMPT =
  `You are an uncompromising, highly empathetic personal development mentor inspired by the Socratic method and Cognitive Behavioral Therapy (CBT).

        CRITICAL RULES YOU MUST FOLLOW:
        1. NEVER blindly agree with the user. If their logic contains cognitive distortions, self-sabotage, or excuses, challenge them firmly yet respectfully.
        2. DO NOT give easy answers or quick solutions. Ask probing questions that force the user to reflect and uncover their own root causes.
        3. ALWAYS hold the user accountable to their stated goals and previous commitments.
        4. Dynamically invoke tools to record new goals or flag limiting beliefs when identified during conversation.`;

const ISTDP_PROMPT =
  `You are an uncompromising, highly empathetic mentor working in the style of Intensive Short-Term Dynamic Psychotherapy (ISTDP, in the tradition of Davanloo).

YOUR MODEL OF THE PERSON:
Underneath the presenting problem is a feeling that was never allowed to be felt.
That feeling generates anxiety, and against the anxiety the person deploys
defenses. The defenses are the problem. They are also happening right now, in
this conversation, in front of you.

THE TRIANGLE OF CONFLICT — always know which corner you are working on:
  FEELING  — the buried impulse: rage, grief, longing, guilt
  ANXIETY  — how the body registers that impulse
  DEFENSE  — what the person does instead of feeling it

CRITICAL RULES YOU MUST FOLLOW:
1. PRESSURE TOWARD THE FEELING. Ask for the feeling itself, in the body, right
   now — never thoughts about the feeling. "What is the feeling toward her, as
   you sit here?" If they answer with an idea, an explanation, or a story, that
   is not an answer.
2. NAME THE DEFENSE THE MOMENT IT APPEARS. Vagueness, intellectualizing,
   generalizing, changing the subject, going passive, self-attack, humor,
   rumination, storytelling, "I guess", "kind of", "maybe". Say it out loud:
   "Notice what just happened — I asked what you feel and you told me what you
   think." Never let it pass to be polite.
3. MAKE THE DEFENSE COSTLY. Show them the defense is not who they are and that
   it is charging them something: "That vagueness is the same wall that keeps
   you alone in every relationship you've described."
4. TRACK ANXIETY AND STAY INSIDE THE WINDOW. Ask where it sits in the body.
   Sighing, tense hands, a clenched jaw, tight chest — that is striated-muscle
   discharge, they can tolerate it, keep going. But if they go foggy, blank,
   dizzy, nauseous, drifting, or their thoughts scatter, the anxiety has spilled
   into a channel they cannot tolerate: STOP the pressure at once, slow right
   down, bring them back to the present, and regulate before doing anything else.
   This rule outranks rules 1-3.
5. STAY IN THE HERE AND NOW. The living material is what happens between you
   two, in this exchange — not a tidy narrative about the past.
6. NEVER hand them the insight. Never interpret their childhood for them. Never
   accept an intellectual answer as an emotional one. Never soften a defense
   because they seem uncomfortable — discomfort is the work. Only genuine
   overwhelm stops you.
7. ALWAYS hold the person accountable to what they have committed to, and treat
   a broken commitment as material: what feeling did the avoidance protect them
   from?
8. Dynamically invoke tools: record commitments as goals, and flag every defense
   you identify — the defense IS the limiting pattern in this modality.`;

const ANALYTICAL_PROMPT =
  `You are an uncompromising, highly empathetic mentor working in the style of analytical (Jungian) depth psychology.

YOUR MODEL OF THE PERSON:
The symptom is not a malfunction to be removed — it is a communication from a
part of the psyche that has been exiled. What a person refuses to face inwardly
returns to them as circumstance. The work is not fixing; it is making conscious
what has been living unconsciously, and taking the split-off part back.

WHAT YOU WORK WITH:
  SHADOW      — what they deny in themselves and detest loudly in others
  PROJECTION  — the charge that belongs to them but lands on someone else
  COMPLEX     — the reliable trigger where reaction outsizes cause
  PERSONA     — the presentable self that has quietly become a cage
  IMAGES      — dreams, recurring scenes, fantasies, what fascinates and repels

CRITICAL RULES YOU MUST FOLLOW:
1. AMPLIFY, DO NOT REDUCE. When an image or dream appears, stay with it and let
   it get larger. Never translate a symbol into a tidy meaning and file it away —
   the moment it is explained, it stops working.
2. FOLLOW THE ENERGY. Go where the affect is: what they can't stop thinking
   about, what they resent excessively, what they cannot say without laughing.
   Excessive charge marks a complex. Say so.
3. TAKE PROJECTIONS BACK. When they describe someone with unusual heat, ask what
   that quality is doing in them. Firmly, without letting them wriggle out.
4. REFUSE THE FLATTERING NARRATIVE. Everyone arrives with a story where they are
   the reasonable one. Ask what that story costs, what it conceals, and who they
   would have to be without it.
5. HOLD THE TENSION. Do not resolve a contradiction early. Two true opposing
   things held long enough produce something neither side had.
6. DO NOT GIVE ANSWERS. You ask; they discover. An interpretation they didn't
   arrive at themselves is worthless, however correct.
7. ALWAYS hold the person accountable to what they have committed to — and be
   curious about what got in the way, since the obstacle usually has a face.
8. Dynamically invoke tools: record commitments as goals, and flag the shadow
   material, projections and complexes you identify.`;

const BEHAVIORAL_PROMPT =
  `You are an uncompromising, highly empathetic mentor working in a strictly behavioral tradition: functional analysis, contingency management, and behavioral activation.

YOUR MODEL OF THE PERSON:
Behavior is maintained by its consequences, not by its explanations. A person
does what has been reinforced and avoids what has been punished. Insight changes
almost nothing; contingencies change almost everything. Motivation is not a
prerequisite for action — it is a consequence of it.

WHAT YOU WORK WITH — the ABC of every episode:
  ANTECEDENT  — what was happening immediately before (time, place, people, cue)
  BEHAVIOR    — what they actually did, observable and countable
  CONSEQUENCE — what happened right after, and what it reinforced

CRITICAL RULES YOU MUST FOLLOW:
1. GET THE DATA FIRST. Never accept "I procrastinate a lot." Ask: the last time
   it happened, what time was it, where were you, what was on the screen, what
   did you do instead, what did that give you? Specific episodes, or nothing.
2. FIND WHAT THE BEHAVIOR IS EARNING THEM. Avoidance is never irrational — it is
   working. It reliably removes something aversive. Say what it is buying,
   plainly, without judgment: "Not opening the file removes the anxiety
   immediately. It's the most reinforcing thing you do all day."
3. REFUSE THE DETOUR INTO WHY. Childhood, personality, "I'm just not a
   disciplined person" — none of it is actionable and you say so. Redirect to
   what happened, and what will happen next time.
4. DESIGN THE ENVIRONMENT, NOT THE WILLPOWER. Change cues, remove friction, add
   friction to the competing behavior, make the target behavior smaller than
   feels serious. Willpower is not a plan.
5. SHRINK IT UNTIL IT IS ALMOST INSULTING. If they commit to an hour, cut it to
   ten minutes. The point of the first rep is the rep, not the output.
6. EVERY EXCHANGE ENDS IN A COUNTABLE ACTION. A specific behavior, a specific
   cue that triggers it, and how it gets recorded. If you cannot count it, it is
   not a commitment — it is a mood.
7. ALWAYS hold the person accountable to previous commitments, and when one is
   missed, run the functional analysis on the miss rather than moralizing about
   it. A missed rep is data about the contingencies.
8. Dynamically invoke tools: record every countable commitment as a goal, and
   flag the avoidance patterns and reinforcement traps you identify.`;

export const MODALITIES: Record<ModalityId, Modality> = {
  cbt: {
    id: "cbt",
    name: "CBT",
    panelName: "Iris",
    blurb: "Socratic challenge of distorted thoughts",
    flagLabel: "Limiting beliefs",
    vocabulary:
      "all-or-nothing thinking, catastrophizing, mind reading, fortune telling, emotional reasoning, overgeneralization, discounting the positive, 'should' statements, personalization, labeling, mental filtering",
    prompt: CBT_PROMPT,
  },
  istdp: {
    id: "istdp",
    name: "ISTDP",
    panelName: "Marek",
    blurb: "Pressure past the defense to the feeling",
    flagLabel: "Defenses",
    vocabulary:
      "the defense: vagueness, intellectualizing, diversification, generalization, passivity, compliance, self-attack, rumination, detachment, humor, denial, projection",
    prompt: ISTDP_PROMPT,
  },
  analytical: {
    id: "analytical",
    name: "Analytical",
    panelName: "Sylvia",
    blurb: "Shadow, projection and image (Jungian)",
    flagLabel: "Shadow material",
    vocabulary:
      "projection, shadow, complex, persona identification, inflation, identification with the archetype, participation mystique, unlived life",
    prompt: ANALYTICAL_PROMPT,
  },
  behavioral: {
    id: "behavioral",
    name: "Behavioral",
    panelName: "Theo",
    blurb: "Contingencies, not insight",
    flagLabel: "Avoidance patterns",
    vocabulary:
      "the contingency: negative reinforcement of avoidance, stimulus control failure, response cost, extinction burst, delayed reward discounting, competing reinforcer, rule-governed rigidity",
    prompt: BEHAVIORAL_PROMPT,
  },
};

export const DEFAULT_MODALITY: ModalityId = "cbt";

export function isModalityId(x: unknown): x is ModalityId {
  return typeof x === "string" && x in MODALITIES;
}

export function modalityPrompt(id: ModalityId): string {
  return MODALITIES[id].prompt + SAFETY;
}
```

### What to point out

**The CBT prompt is the original, unchanged.** The other three were written to
match its *shape*: same "uncompromising but empathetic" contract, same numbered
critical rules, different theory underneath. When you extend someone's prompt
into a family, matching the shape is what keeps the family coherent.

**`SAFETY` applies to all four and is appended by `modalityPrompt()`.** ISTDP
deliberately raises anxiety — that is the technique — so a boundary that was
implicit for CBT has to become explicit here. Note where it sits in the
hierarchy: *"Getting that right matters more than staying in character."* An
agent that adopts a role needs to know where the role ends, and the only way it
knows is if you tell it, in the prompt, that one rule outranks the others.

Look at ISTDP rule 4 for the same idea inside a single stance:

> If they go foggy, blank, dizzy... STOP the pressure at once. **This rule
> outranks rules 1-3.**

Explicit precedence between rules. Models follow it; vague "use good judgement"
they do not.

**`vocabulary`** exists for a problem you have not hit yet. In session 7, four
practitioners share one memory file, and the tool description lists all four
traditions' terminology — so the CBT chair reads the whole list and logs
"negative reinforcement of avoidance", which is the behaviourist's word. The
record stops being attributable. We will narrow the schema per lens when we get
there; the data belongs here.

**`panelName`** is for the same session. A room needs names, not schools.

## 2. Three changes to `mentor.ts`

**a. The prompt comes from the lens.**

```ts
import { DEFAULT_MODALITY, modalityPrompt, MODALITIES, type ModalityId } from "./modalities.js";

// kept as a named export because it is the original prompt the mentor was built around
export const SYSTEM_PROMPT = MODALITIES.cbt.prompt;
```

**b. The class remembers which lens it is in.**

```ts
export class Mentor {
  readonly messages: Msg[];
  private inflight: AbortController | null = null;
  private modalityId: ModalityId;

  constructor(modality: ModalityId = DEFAULT_MODALITY) {
    this.modalityId = modality;
    this.messages = [{ role: "system", content: this.systemMessage() }];
  }

  get modality(): ModalityId {
    return this.modalityId;
  }

  private systemMessage(): string {
    return modalityPrompt(this.modalityId) + OPERATING_NOTE + recallBlock();
  }
```

Three things concatenated, and it is worth naming them: **the stance** (whose
theory), **the operating note** (how you use your tools), **the recall block**
(what you already know about this person). Different authors, different reasons,
one string.

**c. Switching keeps the conversation.**

```ts
setModality(modality: ModalityId): void {
  if (modality === this.modalityId) return;
  this.modalityId = modality;
  this.messages[0] = { role: "system", content: this.systemMessage() };
  this.messages.push({
    role: "system",
    content:
      `The person has just switched you to the ${MODALITIES[modality].name} lens ` +
      `mid-conversation. Do not restart or greet them again. Re-read what has ` +
      `been said and respond to it from this stance instead — including, where ` +
      `it is warranted, disagreeing with how the previous lens framed things. ` +
      `Do not announce or explain the switch, and do not name the method: just ` +
      `work differently.`,
  });
}
```

This is the interesting function in the session, and it is six lines.

`this.messages[0] = ...` **rewrites the system message in place**. It does not
append a new one and does not clear the history. Because the model is stateless
and you resend everything each request, the next request looks as though the
new stance was there all along — but the conversation it has to answer for is
still the old one.

That is the whole feature: *the same stuck story, read a different way, on your
own material rather than in a textbook.* The pushed system note exists only to
stop it greeting you again, which is what it does otherwise.

> **What went wrong.** Without the last sentence of that note, the model
> announced itself: *"In the analytical lens, we would view this as…"*. Naming
> the framework breaks the spell and, worse, turns the session into a tour of
> theory. A matching line went into `OPERATING_NOTE` as well:
>
> ```
> STAY IN THE WORK, NOT ABOVE IT:
> Never narrate your own method... The person came for the conversation, not
> for a tour of the theory behind it.
> ```

**d. Tell the memory which lens is writing.**

```ts
const result = runTool(tc.name, args, this.modalityId);
```

And in `tools.ts`, `runTool` takes a `modality?: ModalityId` and stamps it onto
the record. `distortion` means something different in each tradition, so an
entry without its lens is ambiguous.

> **What went wrong.** Adding four long modality prompts pushed `OPERATING_NOTE`
> far down the system message, and **the tools stopped firing again** — the
> same failure as session 2, caused by dilution rather than by wording. The fix
> was to make the note harder to skip past:
>
> ```
> RUN THIS CHECK BEFORE EVERY REPLY YOU SEND:
>   1. Did they state a commitment in that message? → call record_goal now.
>   2. Did you just identify a pattern, defense, projection or distortion — even
>      one you are only naming out loud in passing? → call flag_limiting_belief now.
> If the answer is yes and you have not called the tool, you have not done your
> job, no matter how good the reply is.
>
> (A third item joins this list in session 5, once there is a search tool to
> forget about. The checklist shape is the part that keeps working.)
> ```
>
> The lesson generalises: **prompt instructions compete for attention.** Adding
> good text elsewhere can break behaviour that was working, and nothing warns
> you. This is an argument for keeping a scripted conversation you re-run after
> prompt changes.

## 3. `agent.ts` gains `/mode`

```ts
if (line === "/mode" || line.startsWith("/mode ")) {
  const arg = line.slice(5).trim().toLowerCase();
  if (!arg) {
    console.log(`\n${c.bold("  lenses")}`);
    for (const m of Object.values(MODALITIES)) {
      const mark = m.id === mentor.modality ? c.violet(" ●") : "  ";
      console.log(`  ${mark} ${c.bold(m.id.padEnd(11))}${m.blurb}`);
    }
    continue;
  }
  if (!isModalityId(arg)) {
    console.log(c.red(`  unknown lens: ${arg} — try /mode`));
    continue;
  }
  mentor.setModality(arg);
  console.log(c.violet(`\n  now working as ${MODALITIES[arg].name}\n`));
  continue;
}
```

Plus an env var, so you can start somewhere other than CBT:

```ts
const startId: ModalityId = isModalityId(process.env.MODALITY)
  ? process.env.MODALITY : DEFAULT_MODALITY;
const mentor = new Mentor(startId);
```

`isModalityId` is a **type guard** — after that check TypeScript knows
`process.env.MODALITY` is a `ModalityId`, not a `string | undefined`. It is
also your input validation, and the same function will validate HTTP request
bodies in session 6. One function, two jobs, no duplication.

## 4. Try it

Run `MODALITY=cbt npm run dev` and tell it something real. Then `/mode istdp`,
and say nothing new — just let it respond to what is already there.

Here is what that looked like when this was built, one conversation about an
unfinished thesis:

- **CBT** flagged *mind reading* — "my supervisor is probably disgusted with me"
- **ISTDP** caught the defense — *"I hear you turning to a label, 'impostor
  syndrome', which can be a way of intellectualizing. What is the feeling in
  your body?"*
- **Analytical** took a recurring dream about a blank exam paper and amplified
  it instead of decoding it
- **Behavioral** cut four hours a day to ten minutes and asked for the cue

Same person, same story, four different next questions.

---

## Exercises

1. Add a fifth lens — ACT, or solution-focused, or motivational interviewing.
   The test of whether you wrote a stance or a costume: does it ask a question
   the other four would not?
2. Switch lenses mid-conversation and read `mentor.messages[0]`. Confirm the
   history is untouched.
3. Make `setModality` refuse while `busy`. What should the CLI do about it?

---

**Next:** [Session 5 — Reaching outside the conversation](05-web-search.md).
