"""Regression suite: the agent must never invent tool-argument values.

    npx tsx evals/dump_contract.ts          # refresh the prompt/tool contract
    .venv/bin/pytest evals -v               # everything
    .venv/bin/pytest evals -v -m "not judge"  # deterministic only, no judge cost

Each case runs the real agent once (session-cached) and is scored twice: a
deterministic lexical check and a GEval judge.
"""

from __future__ import annotations

import functools

import pytest
from deepeval import assert_test
from deepeval.metrics import ToolCorrectnessMetric
from deepeval.test_case import LLMTestCase, ToolCall

from dataset import CASES
from harness import Turn, all_tool_calls, run_conversation, user_text
from metrics import UngroundedArgumentMetric, argument_groundedness_metric


@functools.lru_cache(maxsize=None)
def _run(case_name: str) -> tuple[Turn, ...]:
    """One live agent run per case, shared across the tests that score it."""
    case = next(c for c in CASES if c.name == case_name)
    return tuple(run_conversation(case.turns))


def build_test_case(case_name: str) -> LLMTestCase:
    case = next(c for c in CASES if c.name == case_name)
    transcript = list(_run(case_name))
    calls = all_tool_calls(transcript)
    return LLMTestCase(
        # input is the user's turns ONLY — the agent's own reply must never
        # become evidence for the agent's own arguments.
        input=user_text(transcript),
        actual_output="\n".join(t.reply for t in transcript),
        tools_called=[
            ToolCall(name=c["name"], input_parameters=c["args"]) for c in calls
        ],
        expected_tools=[ToolCall(name=n) for n in case.must_call],
    )


CASE_IDS = [c.name for c in CASES]


@pytest.mark.parametrize("case_name", CASE_IDS)
def test_arguments_are_grounded_lexically(case_name: str):
    """No tool argument may assert something the user never said."""
    assert_test(build_test_case(case_name), [UngroundedArgumentMetric()])


@pytest.mark.judge
@pytest.mark.parametrize("case_name", CASE_IDS)
def test_arguments_are_grounded_semantically(case_name: str):
    """Same rule, judged — catches plausible inference the lexical check allows."""
    assert_test(build_test_case(case_name), [argument_groundedness_metric()])


@pytest.mark.parametrize(
    "case_name", [c.name for c in CASES if c.must_call]
)
def test_expected_tools_are_called(case_name: str):
    """Guard rail: grounding must not be 'fixed' by never calling the tool."""
    assert_test(build_test_case(case_name), [ToolCorrectnessMetric()])


@pytest.mark.parametrize("case_name", [c.name for c in CASES if c.must_not_call])
def test_forbidden_tools_are_not_called(case_name: str):
    case = next(c for c in CASES if c.name == case_name)
    called = {c.name for c in build_test_case(case_name).tools_called or []}
    assert not called & set(case.must_not_call), (
        f"{case_name}: called {called & set(case.must_not_call)} on a turn that "
        "contains no commitment"
    )
