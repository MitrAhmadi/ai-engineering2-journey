import os
from ddgs import DDGS
import subprocess


def list_files(directory="."):
    try:
        files = sorted(os.listdir(directory))
    except OSError as error:
        return f"Error: {error}"

    return "\n".join(files) or "(empty)"


def read_file(path):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return file.read()
    except (OSError, UnicodeError) as error:
        return f"Error: {error}"


def write_file(path, content):
    try:
        with open(path, "w", encoding="utf-8") as file:
            file.write(content)
    except (OSError, UnicodeError) as error:
        return f"Error: {error}"

    return f"Wrote {len(content)} characters to {path}"


def edit_file(path, old_text, new_text):
    if not old_text:
        return "Error: old_text cannot be empty."

    try:
        with open(path, "r", encoding="utf-8") as file:
            content = file.read()
    except (OSError, UnicodeError) as error:
        return f"Error: {error}"

    if old_text not in content:
        return f"Error: The requested text was not found in {path}"

    updated_content = content.replace(old_text, new_text, 1)

    try:
        with open(path, "w", encoding="utf-8") as file:
            file.write(updated_content)
    except (OSError, UnicodeError) as error:
        return f"Error: {error}"

    return f"Edited {path}: replaced the first matching occurrence."


def web_search(query):
    if not query.strip():
        return "Error: Search query cannot be empty."

    try:
        results = DDGS(timeout=10).text(
            query,
            max_results=5,
            backend="duckduckgo",
        )
    except Exception as error:
        return f"Error: Web search failed: {error}"

    if not results:
        return "No search results found."

    formatted_results = []

    for number, result in enumerate(results, start=1):
        title = result.get("title", "No title")
        url = result.get("href", "No URL")
        summary = result.get("body", "No summary")

        formatted_results.append(
            f"{number}. {title}\n"
            f"URL: {url}\n"
            f"Summary: {summary}"
        )

    return "\n\n".join(formatted_results)

def run_command(command):
    if not command.strip():
        return "Error: Command cannot be empty."

    try:
        completed = subprocess.run(
            command,
            shell=True,
            cwd=os.getcwd(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return "Error: Command timed out after 30 seconds."
    except OSError as error:
        return f"Error: Could not run command: {error}"

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()

    result_parts = [
        f"Exit code: {completed.returncode}",
    ]

    if stdout:
        result_parts.append(f"stdout:\n{stdout}")

    if stderr:
        result_parts.append(f"stderr:\n{stderr}")

    if not stdout and not stderr:
        result_parts.append("(no output)")

    return "\n".join(result_parts)

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
                        "description": (
                            "The directory whose contents should be listed."
                        ),
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read and return the text contents of a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path of the text file to read.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                            "Create a new text file or completely overwrite a file. "
                            "Do not use this tool for replacing a specific part of an "
                            "existing file; use edit_file instead."
             ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path of the file to write.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete text content to write.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                            "Replace a specific piece of text in an existing file while "
                            "preserving the rest of its contents. Prefer this tool over "
                            "write_file for partial edits."
             ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path of the existing text file.",
                    },
                    "old_text": {
                        "type": "string",
                        "description": "Exact text to find in the file.",
                    },
                    "new_text": {
                        "type": "string",
                        "description": "Replacement text.",
                    },
                },
                "required": ["path", "old_text", "new_text"],
            },
        },
    },
    {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for current or external information. "
            "Use this when the user explicitly asks to search the web "
            "or needs up-to-date information."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The search query to send to the web search engine."
                    ),
                }
            },
            "required": ["query"],
            },
        },    
    },
    {
    "type": "function",
    "function": {
        "name": "run_command",
        "description": (
            "Execute a shell command in the current working directory "
            "and return its exit code, stdout, and stderr. Use this when "
            "the user explicitly asks to run a command or execute a script. "
            "Do not use it for file operations when a dedicated file tool "
            "is sufficient."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": (
                        "The complete shell command to execute, "
                        "for example: python script.py"
                    ),
                }
            },
            "required": ["command"],
        },
    },
},
]


TOOL_FUNCTIONS = {
    "list_files": lambda arguments: list_files(
        arguments.get("directory") or "."
    ),
    "read_file": lambda arguments: read_file(
        arguments["path"]
    ),
    "write_file": lambda arguments: write_file(
        arguments["path"],
        arguments["content"],
    ),
    "edit_file": lambda arguments: edit_file(
        arguments["path"],
        arguments["old_text"],
        arguments["new_text"],
    ),
    "web_search": lambda arguments: web_search(
        arguments["query"]
    ),
    "run_command": lambda arguments: run_command(
    arguments["command"]
),
}