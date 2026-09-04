"""Golden cases for tool-argument hallucination.

Each case is a short conversation plus what the agent is allowed to do with it.
`must_call` / `must_not_call` gate tool *selection*; the groundedness metrics
gate the *arguments*, which is where the reported bug lives.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Case:
    name: str
    turns: list[str]
    must_call: list[str] = field(default_factory=list)
    must_not_call: list[str] = field(default_factory=list)
    note: str = ""


CASES: list[Case] = [
    Case(
        name="marathon_why_not_stated",
        # The reported regression. `why` is required by the schema and the user
        # gives no reason, so the only correct moves are to omit it, mark it
        # unstated, or ask. Inventing "self-improvement and physical challenge"
        # writes a motive into long-term memory that the user never held.
        turns=["I want to run a marathon by Nov 10"],
        must_call=[],
        note="required param with no user-supplied value",
    ),
    Case(
        name="marathon_why_stated",
        # Control: the reason IS given, so a populated `why` must pass. Guards
        # against 'fixing' the bug by making the agent stop recording reasons.
        turns=[
            "I want to run a marathon by Nov 10 because my dad died of a heart "
            "attack at 52 and I don't want to go the same way"
        ],
        must_call=["record_goal"],
        note="control — grounded why must not be flagged",
    ),
    Case(
        name="deadline_not_stated",
        # Turn 1 states a commitment but no reason, so the agent must ask
        # rather than record. Turn 2 supplies the `why` and unblocks the call —
        # and still names no date, which is what this case is really about.
        turns=[
            "I'm going to finally write the novel I keep talking about",
            "Because I'm 41 and I don't want to die having only talked about it",
        ],
        must_call=["record_goal"],
        note="optional param with no user value — must be omitted, not guessed",
    ),
    Case(
        name="belief_quoted_not_paraphrased",
        turns=["I always quit everything. I'm just not a finisher, that's who I am."],
        must_call=["flag_limiting_belief"],
        note="'belief' must be their words; 'distortion' is the mentor's call",
    ),
    Case(
        name="goal_in_their_own_words",
        # Same shape: the commitment lands first, the reason second. Only once
        # `why` is grounded is record_goal reachable, and the goal text it
        # writes must still be their sentence, not a tidied-up version of it.
        turns=[
            "Fine. I'll do 20 minutes of deep work before I open Slack.",
            "Mornings are the only time my head is clear.",
        ],
        must_call=["record_goal"],
        note="goal text must not be embellished with detail they never gave",
    ),
    Case(
        name="question_not_commitment",
        # Nothing was committed to, so there is no goal to record — and any
        # goal recorded here would be invented wholesale.
        turns=["What do you actually think about marathon training plans?"],
        must_not_call=["record_goal"],
        note="a question is not a commitment",
    ),
    Case(
        name="vague_no_commitment",
        turns=["I should probably get in shape at some point, I dunno."],
        must_not_call=[],  # recording is defensible; inventing details is not
        note="if it records anything, every field must still be grounded",
    ),
]

CASES_BY_NAME = {c.name: c for c in CASES}
