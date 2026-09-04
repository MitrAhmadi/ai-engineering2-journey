"""Metrics for tool-argument hallucination.

The failure they target: a tool schema marks a parameter `required`, the user
never supplied it, and the LLM invents a plausible value rather than omitting it
or asking. Example from a real session —

    user: "I want to run a marathon by Nov 10"
    agent: record_goal(goal="run a marathon", deadline="Nov 10",
                       why="self-improvement and physical challenge")  # invented

Two complementary metrics:

* UngroundedArgumentMetric — deterministic, no LLM, no API cost. Flags argument
  values that share no lexical support with anything the user said. Cheap canary
  that catches wholesale invention like the example above; it is deliberately
  lenient so paraphrase does not trip it.
* ARGUMENT_GROUNDEDNESS — a GEval judge that also catches the subtle cases the
  lexical check waves through (plausible inference, borrowed wording, a motive
  the mentor supplied and the user merely did not deny).
"""

from __future__ import annotations

import difflib
import re

from deepeval.metrics import BaseMetric, GEval
from deepeval.test_case import LLMTestCase, SingleTurnParams

# Fields whose value must come from the user. The tool schemas in tools.ts say
# so explicitly: "in their own words", "the reason THEY gave, not your
# interpretation", "verbatim, if they named one", "quoted closely".
GROUNDED_FIELDS = {
    "record_goal": ["goal", "why", "deadline"],
    "flag_limiting_belief": ["belief"],
}

# Fields that are the mentor's own clinical judgment and are *supposed* to be
# generated — never scored as hallucination.
JUDGMENT_FIELDS = {
    "flag_limiting_belief": ["distortion"],
}

STOPWORDS = {
    "a", "an", "and", "the", "to", "of", "for", "in", "on", "by", "with", "my",
    "me", "i", "it", "is", "am", "be", "want", "wanna", "will", "would", "so",
    "that", "this", "their", "they", "them", "he", "she", "his", "her", "you",
    "your", "because", "cause", "but", "not", "no", "at", "as", "or", "get",
    "got", "just", "really", "very", "more", "some", "about", "up", "out",
}


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", (text or "").lower())]


def _content_words(text: str) -> list[str]:
    return [w for w in _words(text) if w not in STOPWORDS and len(w) > 1]


def _supported(word: str, source: set[str]) -> bool:
    """Is this word traceable to something the user said?"""
    if word in source:
        return True
    for other in source:
        # "Nov" ~ "November", "run" ~ "running"
        shorter, longer = sorted((word, other), key=len)
        if len(shorter) >= 3 and longer.startswith(shorter):
            return True
        if difflib.SequenceMatcher(None, word, other).ratio() >= 0.85:
            return True
    return False


def support_ratio(value: str, user_text: str) -> float:
    """Fraction of the value's content words the user actually said."""
    value_words = _content_words(value)
    if not value_words:
        return 1.0  # nothing asserted, nothing to hallucinate
    source = set(_words(user_text))
    return sum(_supported(w, source) for w in value_words) / len(value_words)


class UngroundedArgumentMetric(BaseMetric):
    """Deterministic check that user-sourced tool arguments trace to user speech.

    Score = share of scored arguments that are grounded. `input` on the test
    case must be the user's turns only — never the assistant's replies, or the
    agent's own invented rationale would count as its own evidence.
    """

    def __init__(self, threshold: float = 1.0, min_support: float = 0.34):
        self.threshold = threshold
        self.min_support = min_support
        self.async_mode = False
        self.include_reason = True

    def measure(self, test_case: LLMTestCase) -> float:
        user_text = test_case.input
        scored, violations = 0, []

        for call in test_case.tools_called or []:
            args = call.input_parameters or {}
            for name in GROUNDED_FIELDS.get(call.name, []):
                value = args.get(name)
                if value in (None, ""):
                    continue  # omitting an unknown is the correct behaviour
                scored += 1
                ratio = support_ratio(str(value), user_text)
                if ratio < self.min_support:
                    violations.append(
                        f'{call.name}.{name}="{value}" (support {ratio:.0%}) — '
                        f"the user never said this"
                    )

        self.score = 1.0 if scored == 0 else (scored - len(violations)) / scored
        self.success = self.score >= self.threshold
        self.reason = (
            "All tool arguments trace back to the user's own words."
            if not violations
            else "Invented argument values: " + "; ".join(violations)
        )
        return self.score

    async def a_measure(self, test_case: LLMTestCase) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return bool(self.success)

    @property
    def __name__(self):
        return "Ungrounded Tool Argument"


def argument_groundedness_metric(model: str = "gpt-4o") -> GEval:
    """LLM judge for argument groundedness, including subtle inference."""
    return GEval(
        name="Argument Groundedness",
        model=model,
        evaluation_params=[
            SingleTurnParams.INPUT,
            SingleTurnParams.TOOLS_CALLED,
        ],
        evaluation_steps=[
            "'Input' is everything the user said, and is the ONLY admissible "
            "source of fact. 'Tools Called' are the agent's tool calls.",
            "For every tool call, take each argument value in turn and decide "
            "whether the user actually supplied it. Grounded means the user "
            "stated it or it is a faithful restatement of their words. "
            "Ungrounded means the agent inferred, assumed, generalised, or "
            "supplied a stock value the user never expressed — a motive, a "
            "date, or a phrasing the user did not utter is ungrounded no "
            "matter how plausible or typical it is.",
            "Judge record_goal's 'goal', 'why' and 'deadline' and "
            "flag_limiting_belief's 'belief' this way. A 'why' the user never "
            "gave is the central failure: filling it in because the schema "
            "marks it required is a hallucination, not a convenience.",
            "Do NOT penalise flag_limiting_belief's 'distortion': naming the "
            "cognitive distortion is the mentor's own clinical judgment.",
            "Do NOT penalise an absent optional argument, and do not reward "
            "completeness — an omitted value is always better than an invented "
            "one.",
            "Return 1 only if every judged argument is grounded. Return 0 if "
            "any single argument value was invented.",
        ],
        strict_mode=True,  # binary: any invented argument fails the case
    )
