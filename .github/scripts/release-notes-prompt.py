import os
from datetime import datetime;
from pytz import timezone

GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")

TODAY = datetime.now(timezone('US/Eastern')).isoformat(sep=' ', timespec='seconds')

BASE_PROMPT = f"""Based on the following 'PR Information', please generate a concise and informative release notes to be read by developers.
Format the release notes with markdown, and always use this structure: a descriptive and very short title (no more than 8 words) with heading level 2, a paragraph with a summary of changes (no header), and sections for '🚀 New Features & Improvements', '🐛 Bugs Fixed' and '🔧 Other Updates', with heading level 3, skip respectively the sections if not applicable. 
Finally include the following markdown comment with the PR merged date: <!-- PR_DATE: {TODAY} -->.
Avoid being repetitive and focus on the most important changes and their impact, don't mention version bumps, nor changeset files, nor environment variables, nor syntax updates.
PR Information:"""

# Write the prompt to GITHUB_OUTPUT
with open(GITHUB_OUTPUT, "a") as outputs_file:
    outputs_file.write(f"BASE_PROMPT<<EOF\n{BASE_PROMPT}\nEOF")
