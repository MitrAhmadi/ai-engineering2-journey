import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from tools import TOOLS
from agent import SYSTEM_PROMPT


load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

MODEL = "openai/gpt-5-mini"
JUDGE_MODEL = MODEL
MAX_STEPS = 5

CASES = [
    {
        "name": "Inspect tools file",
        "task": (
            "First inspect the available files. Then read tools.py "
            "and explain which tools it defines."
        ),
        "required_trace": ["list_files", "read_file"],
        "mock_results": {
            "list_files": "agent.py\ntools.py",
            "read_file": (
                "tools.py defines six tools: list_files lists directory contents, "
                "read_file reads text file contents, write_file creates or "
                "overwrites a text file, edit_file replaces the first exact "
                "occurrence of text in an existing file, web_search searches the "
                "web and returns formatted results, and run_command executes a "
                "shell command and returns its exit code, stdout, and stderr."
            ),
        },
        "criteria": (
                "The answer must say that tools.py defines six tools: list_files, "
                "read_file, write_file, edit_file, web_search, and run_command, "
                "and must correctly describe their purposes without adding "
                "unsupported claims."
        ),
    },
    {
        "name": "Grounded web search",
        "task": (
            "Search the web for the scheduled launch date of "
            "Project Atlas A17. Answer with the date and source URL."
        ),
        "required_trace": ["web_search"],
        "mock_results": {
            "web_search": (
                "1. Project Atlas A17 launch schedule\n"
                "URL: https://example.test/project-atlas-a17\n"
                "Summary: Project Atlas A17 is scheduled to launch "
                "on June 17, 2031."
            ),
        },
        "criteria": (
            "The answer must state June 17, 2031 and include "
            "https://example.test/project-atlas-a17. It must not add "
            "unsupported factual claims."
        ),
    },
    {
        "name": "Stateful file write",
        "task": (
            "Create notes.txt containing exactly: Stateful mocks work. "
            "Then read notes.txt and report its contents."
        ),
        "required_trace": ["write_file", "read_file"],
        "initial_files": {},
        "mock_results": {},
        "criteria": (
            "The answer must confirm that notes.txt contains exactly "
            "Stateful mocks work. It must not claim unsupported content."
        ),
    },
    {
        "name": "Stateful file edit",
        "task": (
            "Read notes.txt, replace the exact word old with new, then "
            "read the file again and report its final contents."
        ),
        "required_trace": ["read_file", "edit_file", "read_file"],
        "initial_files": {
            "notes.txt": "Status: old",
        },
        "mock_results": {},
        "criteria": (
            "The answer must report the final contents as Status: new. "
            "It must not claim that the edit failed or add unsupported "
            "file contents."
        ),
    },
    {
        "name": "Write and run a script",
        "task": (
            "Create hello.py containing Python code that prints exactly "
            "'Hello from the generated script.' Then run the script and "
            "report its output."
        ),
        "required_trace": ["write_file", "run_command"],
        "initial_files": {},
        "mock_results": {
            "run_command": (
                "Exit code: 0\n"
                "stdout:\n"
                "Hello from the generated script."
            ),
        },
        "criteria": (
            "The answer must report that the script ran successfully and "
            "printed exactly: Hello from the generated script. It must not "
            "add unsupported execution results."
        ),
    },
]


def normalize_mock_path(path):
    normalized = os.path.normpath(path or ".")
    return normalized.replace("\\", "/")


def run_stateful_file_tool(tool_name, arguments, mock_files):
    if tool_name == "list_files":
        directory = normalize_mock_path(arguments.get("directory") or ".")

        if directory != ".":
            return f"Error: No mock directory exists at '{directory}'"

        return "\n".join(sorted(mock_files)) or "(empty)"

    path = normalize_mock_path(arguments.get("path"))

    if tool_name == "read_file":
        return mock_files.get(
            path,
            f"Error: No mock file exists at '{path}'",
        )

    if tool_name == "write_file":
        content = arguments.get("content")

        if content is None:
            return "Error: The content argument is required."

        mock_files[path] = content
        return f"Wrote {len(content)} characters to {path}"

    if tool_name == "edit_file":
        old_text = arguments.get("old_text")
        new_text = arguments.get("new_text")

        if not old_text:
            return "Error: old_text cannot be empty."

        if new_text is None:
            return "Error: The new_text argument is required."

        if path not in mock_files:
            return f"Error: No mock file exists at '{path}'"

        if old_text not in mock_files[path]:
            return f"Error: The requested text was not found in {path}"

        mock_files[path] = mock_files[path].replace(
            old_text,
            new_text,
            1,
        )
        return f"Edited {path}: replaced the first matching occurrence."

    return None


def get_mock_result(tool_name, arguments, mock_results, mock_files):
    if mock_files is not None:
        stateful_result = run_stateful_file_tool(
            tool_name,
            arguments,
            mock_files,
        )

        if stateful_result is not None:
            return stateful_result

    return mock_results.get(
        tool_name,
        f"Error: No mock result for '{tool_name}'",
    )

def run_with_mocks(task, mock_results, initial_files=None):
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": task,
        }
    ]

    tool_trace = []
    evidence_parts = []
    mock_files = (
        dict(initial_files)
        if initial_files is not None
        else None
    )

    for _ in range(MAX_STEPS):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            parallel_tool_calls=False,
            temperature=0,
        )

        assistant_message = response.choices[0].message
        messages.append(assistant_message)

        tool_calls = assistant_message.tool_calls or []

        if not tool_calls:
            evidence = "\n\n".join(evidence_parts)
            return assistant_message.content or "", tool_trace, evidence

        for tool_call in tool_calls:
            tool_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            tool_trace.append(tool_name)

            result = get_mock_result(
                tool_name,
                arguments,
                mock_results,
                mock_files,
            )

            evidence_parts.append(
                f"{tool_name}({arguments}) returned:\n{result}"
            )

            print(f"[mock] {tool_name}({arguments})")

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                }
            )

    evidence = "\n\n".join(evidence_parts)
    return "Stopped: step limit reached.", tool_trace, evidence


def judge_answer(task, answer, evidence, criteria):

    tool_schemas = json.dumps(
        TOOLS,
        indent=2,
        ensure_ascii=False,
    )
    response = client.chat.completions.create(
        model=JUDGE_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict grounded evaluator. "
                    "Reply with exactly PASS or FAIL. "
                    "The task itself is not evidence. "
                    "Claims about tool names, purposes, and arguments must be "
                    "supported by the provided tool schemas. "
                    "Claims about files, web results, or executed actions must be "
                    "supported by the runtime evidence. "
                    "Return FAIL for any unsupported factual claim."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Task:\n{task}\n\n"
                    f"Agent system prompt:\n{SYSTEM_PROMPT}\n\n"
                    f"Tool schemas:\n{tool_schemas}\n\n"
                    f"Runtime evidence:\n{evidence}\n\n"
                    f"Answer:\n{answer}\n\n"
                    f"Passing criteria:\n{criteria}"
                ),
            },
        ],
        temperature=0,
    )

    return (response.choices[0].message.content or "").strip().upper()


def contains_in_order(tool_trace, required_trace):
    required_index = 0

    for tool_name in tool_trace:
        if (
            required_index < len(required_trace)
            and tool_name == required_trace[required_index]
        ):
            required_index += 1

    return required_index == len(required_trace)


passed = 0

for case in CASES:
    print(f"\n=== {case['name']} ===")

    answer, tool_trace, evidence = run_with_mocks(
        case["task"],
        case["mock_results"],
        case.get("initial_files"),
    )

    trace_passed = contains_in_order(
        tool_trace,
        case["required_trace"],
    )

    trace_efficient = tool_trace == case["required_trace"]

    judge_result = judge_answer(
        case["task"],
        answer,
        evidence,
        case["criteria"],
    )

    answer_passed = judge_result == "PASS"
    case_passed = trace_passed and answer_passed

    if case_passed:
        passed += 1

    print(f"\nTool trace: {tool_trace}")
    print(f"Required:   {case['required_trace']}")
    print(
        "Required trace: "
        f"{'PASS' if trace_passed else 'FAIL'}"
    )
    print(
        "Trace efficiency: "
        f"{'PASS' if trace_efficient else 'WARN'}"
    )
    print(f"\nEvidence:\n{evidence}")
    print(f"\nFinal answer:\n{answer}")
    print(f"\nJudge: {judge_result}")
    print(f"Case result: {'PASS' if case_passed else 'FAIL'}")

print(f"\n{passed}/{len(CASES)} passed")
