import os

from dotenv import load_dotenv
from openai import OpenAI

from tools import TOOLS


load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

MODEL = "openai/gpt-5-mini"


CASES = [
    {
        "prompt": "What files are inside Homeworks/week1?",
        "expected": ["list_files"],
    },
        {
        "prompt": "Read the contents of Homeworks/week1/agent.py",
        "expected": ["read_file"],
    },
    {
        "prompt": "Show me the contents of the current directory.",
        "expected": ["list_files"],
    },
    {
        "prompt": "What is the capital of Japan?",
        "expected": [],
    },
    {
        "prompt": "Create hello.txt containing hello world.",
        "expected": ["write_file"],
    },
    {
        "prompt": (
            'Call the edit_file tool directly to replace "old" with "new" '
            'in notes.txt. Do not read the file first.'
        ),
        "expected": ["edit_file"],
    },
    {
        "prompt": "Show me the exact text stored in README.md.",
        "expected": ["read_file"],
    },
    {
        "prompt": "Which items are available in the Homeworks directory?",
        "expected": ["list_files"],
    },
    {
        "prompt": (
            "Save the sentence 'Evaluation is important.' "
            "in a new file named evaluation_note.txt."
        ),
        "expected": ["write_file"],
    },
    {
        "prompt": (
            'Without reading the file first, change "draft" to "final" '
            "inside report.txt."
        ),
        "expected": ["edit_file"],
    },
    {
        "prompt": "Explain what a directory is. Do not inspect any files.",
        "expected": [],
    },
    {
        "prompt": (
            "Do not create any file. Just tell me what write_file "
            "would normally be used for."
        ),
        "expected": [],
    },
    {
        "prompt": (
            "I have a file named secrets.txt, but do not open it. "
            "Explain why API keys should be kept private."
        ),
        "expected": [],
    },
    {
        "prompt": (
            "What Python function is commonly used to open a text file? "
            "Do not access the filesystem."
        ),
        "expected": [],
    },
    {
        "prompt": (
            "Search the web for the latest stable version of Python."
        ),
        "expected": ["web_search"],
    },
    {
        "prompt": (
            "What is Python used for? Answer from your existing knowledge "
            "and do not search the web."
        ),
        "expected": [],
    },
    {
        "prompt": "What is the weather in Tehran today?",
        "expected": ["web_search"],
    },
    {
        "prompt": "What is the weather in Paris today?",
        "expected": ["web_search"],
    },
    {
        "prompt": "Is it currently raining in Istanbul?",
        "expected": ["web_search"],
    },
    {
        "prompt": "What is the weather like?",
        "expected": [],
    },
    {
        "prompt": (
            "Without searching the web, explain why desert regions "
            "become cold at night."
        ),
        "expected": [],
    },
    {
        "prompt": (
            "Search the web and tell me whether I need an umbrella "
            "in London today."
        ),
        "expected": ["web_search"],
    },
    {
        "prompt": "Run python --version and report the output.",
        "expected": ["run_command"],
    },
    {
        "prompt": (
            "Explain what exit code 0 usually means. "
            "Do not execute any command."
        ),
        "expected": [],
    },
]


def tools_chosen(prompt):
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        tools=TOOLS,
        tool_choice="auto",
        temperature=0,
    )

    message = response.choices[0].message

    chosen = [
        tool_call.function.name
        for tool_call in message.tool_calls or []
    ]

    return chosen, message.content or ""


passed = 0

for case in CASES:
    chosen, model_text = tools_chosen(case["prompt"])
    is_correct = set(chosen) == set(case["expected"])

    if is_correct:
        passed += 1

    status = "PASS" if is_correct else "FAIL"

    print(
        f"[{status}] {case['prompt']!r} "
        f"expected={case['expected']} chosen={chosen}"
    )

    if not is_correct and model_text:
        print(f"  Model text: {model_text}")

print(f"\n{passed}/{len(CASES)} passed")
