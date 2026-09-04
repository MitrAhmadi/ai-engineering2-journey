"""Runs the mentor agent headlessly and captures the tool calls it makes.

Uses evals/contract.json (generated from prompts.ts / tools.ts) so the system
prompt and tool schemas can never drift from what agent.ts actually ships.
Tool execution is stubbed: evals never write to state.json.
"""

from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass, field

from openai import OpenAI

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "evals" / "contract.json"
MODEL = os.environ.get("MODEL", "gpt-4")
MAX_STEPS = 6  # mirrors the tool loop in agent.ts


def load_contract() -> dict:
    if not CONTRACT.exists():
        raise SystemExit(
            f"{CONTRACT} missing — run `pnpm eval:contract` (npx tsx evals/dump_contract.ts) first."
        )
    return json.loads(CONTRACT.read_text())


@dataclass
class Turn:
    """One user turn and everything the agent did in response to it."""

    user: str
    reply: str = ""
    tool_calls: list[dict] = field(default_factory=list)  # {name, args}


def stub_tool_result(name: str) -> str:
    """Stand in for tools.runTool without touching state.json."""
    if name == "record_goal":
        return json.dumps({"ok": True, "totalGoals": 1})
    if name == "flag_limiting_belief":
        return json.dumps({"ok": True, "totalBeliefs": 1})
    return json.dumps({"ok": False, "error": f"unknown tool: {name}"})


def run_conversation(user_turns: list[str], model: str | None = None) -> list[Turn]:
    """Replay user turns against the agent, returning what it said and called."""
    contract = load_contract()
    client = OpenAI()
    messages: list[dict] = [{"role": "system", "content": contract["system"]}]
    transcript: list[Turn] = []

    for user in user_turns:
        messages.append({"role": "user", "content": user})
        turn = Turn(user=user)

        for _ in range(MAX_STEPS):
            completion = client.chat.completions.create(
                model=model or MODEL,
                messages=messages,
                tools=contract["tools"],
            )
            msg = completion.choices[0].message
            if msg.content:
                turn.reply += msg.content

            calls = msg.tool_calls or []
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content,
                    **(
                        {
                            "tool_calls": [
                                {
                                    "id": c.id,
                                    "type": "function",
                                    "function": {
                                        "name": c.function.name,
                                        "arguments": c.function.arguments,
                                    },
                                }
                                for c in calls
                            ]
                        }
                        if calls
                        else {}
                    ),
                }
            )
            if not calls:
                break

            for c in calls:
                args = json.loads(c.function.arguments or "{}")
                turn.tool_calls.append({"name": c.function.name, "args": args})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": c.id,
                        "content": stub_tool_result(c.function.name),
                    }
                )

        transcript.append(turn)

    return transcript


def user_text(transcript: list[Turn]) -> str:
    """Everything the user actually said — the only legitimate source for args."""
    return "\n".join(t.user for t in transcript)


def all_tool_calls(transcript: list[Turn]) -> list[dict]:
    return [tc for t in transcript for tc in t.tool_calls]
