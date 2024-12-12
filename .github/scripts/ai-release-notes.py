"""
AI-powered release notes generator that creates concise and informative release notes from git changes.

This script uses OpenAI's API to analyze git changes (summary, diff, and commit log) and generate
well-formatted release notes in markdown. It focuses on important changes and their impact,
particularly highlighting new types and schemas while avoiding repetitive information.

Environment Variables Required:
    OPENAI_API_KEY: OpenAI API key for authentication
    CHANGE_SUMMARY: Summary of changes made (optional if CUSTOM_PROMPT provided)
    CHANGE_DIFF: Git diff of changes (optional if CUSTOM_PROMPT provided)
    CHANGE_LOG: Git commit log (optional if CUSTOM_PROMPT provided)
    GITHUB_OUTPUT: Path to GitHub output file
    CUSTOM_PROMPT: Custom prompt to override default (optional)
"""

import os
import requests  # type: ignore
import json
import tiktoken # type: ignore

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
CHANGE_SUMMARY = os.environ.get('CHANGE_SUMMARY', '')
CHANGE_DIFF = os.environ.get('CHANGE_DIFF', '')
CHANGE_LOG = os.environ.get('CHANGE_LOG', '')
GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")
OPEN_AI_BASE_URL = "https://api.openai.com/v1"
OPEN_API_HEADERS = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
CUSTOM_PROMPT = os.environ.get('CUSTOM_PROMPT', '')
MODEL_NAME = os.environ.get('MODEL_NAME', 'gpt-3.5-turbo-16k')

def num_tokens_from_string(string: str, model_name: str) -> int:
    """
    Calculate the number of tokens in a text string for a specific model.
    
    Args:
        string: The input text to count tokens for
        model_name: Name of the OpenAI model to use for token counting
    
    Returns:
        int: Number of tokens in the input string
    """
    encoding = tiktoken.encoding_for_model(model_name)
    num_tokens = len(encoding.encode(string))
    return num_tokens

def truncate_to_token_limit(text, max_tokens, model_name):
    """
    Truncate text to fit within a maximum token limit for a specific model.
    
    Args:
        text: The input text to truncate
        max_tokens: Maximum number of tokens allowed
        model_name: Name of the OpenAI model to use for tokenization
    
    Returns:
        str: Truncated text that fits within the token limit
    """
    encoding = tiktoken.encoding_for_model(model_name)
    encoded = encoding.encode(text)
    truncated = encoded[:max_tokens]
    return encoding.decode(truncated)

def generate_release_notes(model_name):
    """
    Generate release notes using OpenAI's API based on git changes.
    
    Uses the GPT-3.5-turbo model to analyze change summary, commit log, and code diff
    to generate concise and informative release notes in markdown format. The notes
    focus on important changes and their impact, with sections for new types/schemas
    and other updates.
    
    Returns:
        str: Generated release notes in markdown format
    
    Raises:
        requests.exceptions.RequestException: If the OpenAI API request fails
    """
    max_tokens = 14000  # Reserve some tokens for the response

    # Truncate inputs if necessary to fit within token limits
    change_summary = '' if CUSTOM_PROMPT else truncate_to_token_limit(CHANGE_SUMMARY, 1000, model_name)
    change_log = '' if CUSTOM_PROMPT else truncate_to_token_limit(CHANGE_LOG, 2000, model_name)
    change_diff = '' if CUSTOM_PROMPT else truncate_to_token_limit(CHANGE_DIFF, max_tokens - num_tokens_from_string(change_summary, model_name) - num_tokens_from_string(change_log, model_name) - 1000, model_name)

    url = f"{OPEN_AI_BASE_URL}/chat/completions"

    # Construct prompt for OpenAI API
    openai_prompt = CUSTOM_PROMPT if CUSTOM_PROMPT else f"""Based on the following summary of changes, commit log and code diff, please generate concise and informative release notes:
    Summary of changes:
    {change_summary}
    Commit log:
    {change_log}
    Code Diff:
    {json.dumps(change_diff)}
    """

    data = {
        "model": model_name,
        "messages": [{"role": "user", "content": openai_prompt}],
        "temperature": 0.7,
        "max_tokens": 1000,
    }

    print("----------------------------------------------------------------------------------------------------------")
    print("POST request to OpenAI")
    print("----------------------------------------------------------------------------------------------------------")
    ai_response = requests.post(url, headers=OPEN_API_HEADERS, json=data)
    print(f"Status Code: {str(ai_response.status_code)}")
    print(f"Response: {ai_response.text}")
    ai_response.raise_for_status()

    return ai_response.json()["choices"][0]["message"]["content"]

release_notes = generate_release_notes(MODEL_NAME)
print("----------------------------------------------------------------------------------------------------------")
print("OpenAI generated release notes")
print("----------------------------------------------------------------------------------------------------------")
print(release_notes)

# Write the release notes to GITHUB_OUTPUT
with open(GITHUB_OUTPUT, "a") as outputs_file:
    outputs_file.write(f"RELEASE_NOTES<<EOF\n{release_notes}\nEOF")
