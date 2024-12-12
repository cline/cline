import os
import subprocess
import json
import re
import tiktoken # type: ignore
from datetime import datetime;
from pytz import timezone

GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")
BASE_REF = os.getenv("BASE_REF", "main")
HEAD_SHA = os.environ["HEAD_SHA"]
PR_TITLE = os.environ["PR_TITLE"]
PR_BODY = os.environ["PR_BODY"]
EXISTING_NOTES = os.environ.get("EXISTING_NOTES", "null")
MODEL_NAME = os.environ.get('MODEL_NAME', 'gpt-3.5-turbo-16k')
CUSTOM_PROMPT = os.environ.get('CUSTOM_PROMPT', '')

def extract_description_section(pr_body):
    # Find content between ## Description and the next ## or end of text
    description_match = re.search(r'## Description\s*\n(.*?)(?=\n##|$)', pr_body, re.DOTALL)
    if description_match:
        content = description_match.group(1).strip()
        # Remove the comment line if it exists
        comment_pattern = r'\[comment\]:.+?\n'
        content = re.sub(comment_pattern, '', content)
        return content.strip()
    return ""

def extract_ellipsis_important(pr_body):
    # Find content between <!-- ELLIPSIS_HIDDEN --> and <!-- ELLIPSIS_HIDDEN --> that contains [!IMPORTANT]
    ellipsis_match = re.search(r'<!--\s*ELLIPSIS_HIDDEN\s*-->(.*?)<!--\s*ELLIPSIS_HIDDEN\s*-->', pr_body, re.DOTALL)
    if ellipsis_match:
        content = ellipsis_match.group(1).strip()
        important_match = re.search(r'\[!IMPORTANT\](.*?)(?=\[!|$)', content, re.DOTALL)
        if important_match:
            important_text = important_match.group(1).strip()
            important_text = re.sub(r'^-+\s*', '', important_text)
            return important_text.strip()
    return ""

def extract_coderabbit_summary(pr_body):
    # Find content between ## Summary by CodeRabbit and the next ## or end of text
    summary_match = re.search(r'## Summary by CodeRabbit\s*\n(.*?)(?=\n##|$)', pr_body, re.DOTALL)
    return summary_match.group(1).strip() if summary_match else ""

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

# Extract sections and combine into PR_OVERVIEW
description = extract_description_section(PR_BODY)
important = extract_ellipsis_important(PR_BODY)
summary = extract_coderabbit_summary(PR_BODY)

PR_OVERVIEW = "\n\n".join(filter(None, [description, important, summary]))

# Get git information
base_sha = subprocess.getoutput(f"git rev-parse origin/{BASE_REF}") if BASE_REF == 'main' else BASE_REF
diff_overview = subprocess.getoutput(f"git diff {base_sha}..{HEAD_SHA} --name-status | awk '{{print $2}}' | sort | uniq -c | awk '{{print $2 \": \" $1 \" files changed\"}}'")
git_log = subprocess.getoutput(f"git log {base_sha}..{HEAD_SHA} --pretty=format:'%h - %s (%an)' --reverse | head -n 50")
git_diff = subprocess.getoutput(f"git diff {base_sha}..{HEAD_SHA} --minimal --abbrev --ignore-cr-at-eol --ignore-space-at-eol --ignore-space-change --ignore-all-space --ignore-blank-lines --unified=0 --diff-filter=ACDMRT")

max_tokens = 14000  # Reserve some tokens for the response
changes_summary = truncate_to_token_limit(diff_overview, 1000, MODEL_NAME)
git_logs = truncate_to_token_limit(git_log, 2000, MODEL_NAME)
changes_diff = truncate_to_token_limit(git_diff, max_tokens - num_tokens_from_string(changes_summary, MODEL_NAME) - num_tokens_from_string(git_logs, MODEL_NAME) - 1000, MODEL_NAME)

# Get today's existing changelog if any
existing_changelog = EXISTING_NOTES if EXISTING_NOTES != "null" else None
existing_changelog_text = f"\nAdditional context:\n{existing_changelog}" if existing_changelog else ""
TODAY = datetime.now(timezone('US/Eastern')).isoformat(sep=' ', timespec='seconds')

BASE_PROMPT = CUSTOM_PROMPT if CUSTOM_PROMPT else f"""Based on the following 'PR Information', please generate concise and informative release notes to be read by developers.
Format the release notes with markdown, and always use this structure: a descriptive and very short title (no more than 8 words) with heading level 2, a paragraph with a summary of changes (no header), and if applicable, sections for '🚀 New Features & Improvements', '🐛 Bugs Fixed' and '🔧 Other Updates', with heading level 3, skip respectively the sections if not applicable. 
Finally include the following markdown comment with the PR merged date: <!-- PR_DATE: {TODAY} -->.
Avoid being repetitive and focus on the most important changes and their impact, discard any mention of version bumps/updates, changeset files, environment variables or syntax updates.
PR Information:"""

OPENAI_PROMPT = f"""{BASE_PROMPT}
Git log summary:
{changes_summary}
Commit Messages:
{git_logs}
PR Title:
{PR_TITLE}
PR Overview:
{PR_OVERVIEW}{existing_changelog_text}
Code Diff:
{json.dumps(changes_diff)}"""

print("OpenAI Prompt")
print("----------------------------------------------------------------")
print(OPENAI_PROMPT)

# Write the prompt to GITHUB_OUTPUT
with open(GITHUB_OUTPUT, "a") as outputs_file:
    outputs_file.write(f"OPENAI_PROMPT<<EOF\n{OPENAI_PROMPT}\nEOF")
