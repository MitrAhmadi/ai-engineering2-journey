import json
import os

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")

if not api_key:
    raise RuntimeError("OPENROUTER_API_KEY was not found.")

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)

MODEL = "openai/gpt-5-mini"


def list_files(directory="."):
    try:
        files = sorted(os.listdir(directory))
    except OSError as error:
        return f"Error: {error}"

    return "\n".join(files) or "(empty)"


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List the files and folders inside a directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "The directory whose contents should be listed.",
                    }
                },
                "required": [],
            },
        },
    }
]


messages = [
    {
        "role": "user",
        "content": "What is the capital of Japan?",
    }
]


# Step 1: Let the model decide whether it needs a tool.
first_response = client.chat.completions.create(
    model=MODEL,
    messages=messages,
    tools=TOOLS,
    tool_choice="auto",
)

assistant_message = first_response.choices[0].message
messages.append(assistant_message)

tool_calls = assistant_message.tool_calls or []

if not tool_calls:
    print("The model did not request a tool.")
    print(assistant_message.content)
    raise SystemExit


# Step 2: Execute every tool requested by the model.
for tool_call in tool_calls:
    tool_name = tool_call.function.name
    arguments = json.loads(tool_call.function.arguments)

    print(f"Model requested: {tool_name}({arguments})")

    if tool_name == "list_files":
        result = list_files(arguments.get("directory", "."))
    else:
        result = f"Error: Unknown tool '{tool_name}'"

    messages.append(
        {
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result,
        }
    )


# Step 3: Give the tool result back to the model.
second_response = client.chat.completions.create(
    model=MODEL,
    messages=messages,
    tools=TOOLS,
)

final_answer = second_response.choices[0].message.content

print(f"\nAgent answer:\n{final_answer}")