import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from tools import TOOLS, TOOL_FUNCTIONS


load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")

if not api_key:
    raise RuntimeError("OPENROUTER_API_KEY was not found.")

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)

MODEL = "openai/gpt-5-mini"
MAX_STEPS = 15
RISKY_TOOLS = {"write_file" , "edit_file" , "run_command"}

SYSTEM_PROMPT = (
    "You are a helpful command-line AI assistant. "
    "Use edit_file whenever the user asks to replace or modify only a "
    "specific part of an existing file. Do not simulate a partial edit by "
    "reading the file and passing reconstructed full contents to write_file. "
    "Use write_file only when creating a new file or when the user explicitly "
    "requests replacing the entire file contents. "
    "Respect denied tool calls. If the user denies an action, do not retry it "
    "or suggest an alternative way to perform the same action unless the user "
    "explicitly asks for alternatives."
)

def approve_tool(tool_name, arguments):
    if tool_name not in RISKY_TOOLS:
        return True

    print(f"\nApproval required: {tool_name}({arguments})")

    decision = input("Allow this action? [y/N] ").strip().lower()

    return decision == "y"

def run_agent_turn(messages):
    for step in range(MAX_STEPS):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        assistant_message = response.choices[0].message
        messages.append(assistant_message)

        tool_calls = assistant_message.tool_calls or []

        # No tool request means the model has produced its final answer.
        if not tool_calls:
            return assistant_message.content or ""

        for tool_call in tool_calls:
            tool_name = tool_call.function.name

            try:
                arguments = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError as error:
                arguments = {}
                result = f"Error: Invalid tool arguments: {error}"
            else:
                tool_function = TOOL_FUNCTIONS.get(tool_name)

                if tool_function is None:
                    status = "ERROR"
                    result = f"Error: Unknown tool '{tool_name}'"

                elif not approve_tool(tool_name, arguments):
                    status = "DENIED"
                    result = "User denied this action."

                else:
                    try:
                        result = tool_function(arguments)
                        status = "EXECUTED"
                    except Exception as error:
                        status = "ERROR"
                        result = f"Error while running {tool_name}: {error}"

                print(f"  tool › {status} {tool_name}({arguments})")

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                }
            )

    return f"Stopped after reaching the {MAX_STEPS}-step limit."


def main():
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        }
    ]

    print("Agent ready. Type 'exit' to quit.")

    while True:
        user_input = input("\nyou › ").strip()

        if not user_input:
            continue

        if user_input.lower() in {"exit", "quit"}:
            print("agent › Goodbye!")
            break

        messages.append(
            {
                "role": "user",
                "content": user_input,
            }
        )

        answer = run_agent_turn(messages)

        print(f"\nagent › {answer}")


if __name__ == "__main__":
    main()