# SDK Migration Caveats & Known Issues

Tracking issues found during the migration from the legacy inference system to the ClineCore SDK.

## Status Legend
- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🟢 **Fixed** — resolved

NOTE:

1. Use your debugging tool (DEBUG-HARNESS.md) to reproduce issues.
2. Use your debugging tool to validate your fixes.
3. Commit one verified change together.
4. Work on these in any order you prefer.

---

🟢 Under accounts, the when logged in the "current balance" is ---- and
the reload button does nothing. **Fixed:** getUserCredits handler fetches
balance from Cline API using stored auth token.

🟢 Under accounts, the "cline environment" dropdown doesn't change from
production when you select "staging" or "local". **Fixed:** state-builder
now reads `clineEnv` from globalState and maps to Environment enum;
updateSettings handler persists clineEnv and clears auth on change.

🟢 Under accounts, the logout button does nothing. **Fixed:**
accountLogoutClicked handler clears auth credentials from disk.

🟢 Reportedly under accounts you can't sign in. **Fixed:**
accountLoginClicked handler (was STUB) now opens the Cline login page
in the browser.

🔴 When you have a low credit balance, even after you change accounts
(for example from one "org" to another) or refreshing you keep getting
an error "Insufficient balance. Your Cline Credits balance ..."

🔴 In chat, a chat response has a "copy" button that is
obscured/partially obscured by the last generated code block. In the
classic extension, this appears with enough space around it to be
visible.

🔴 Changing the model during a conversation does not, *apparently*,
change the model used for inference.

🔴 The OpenAI compatible provider produces "404 404 page not found"
errors.

🔴 When running tools (for example, prompt the agent to use kb_status)
output rectangles appear but they are blank.

🔴 When prompted with multiple-step work (like 1. Do this 2. Do that)
the chat displays "0/0 TODOs".

🟡 Checkpoints appear in options, but checkpoints don't appear in
chats; we need to overhaul the checkpoints system anyway see
ARCHITECTURE.md.

🟢 In the history section, you can't mark chats as favorites.

🟡 Banners (for example "Try Claude Sonnet 4.6") can be dismissed, but
there are no < and > buttons visible to page between them.

🔴 "Add to Cline" right click menu (use the command to trigger it)
does not do anything.

🟢 When a task is cancelled, you can't enter a new chat and send that
chat in addition. (The repro is: Run a task, click cancel relatively
quickly, type a new prompt, try to hit enter/click the arrow.) **Fixed:**
cancelTask now clears currentSession after abort so subsequent
askResponse calls start a new task instead of sending to the aborted
session.

🔴 MCP Servers tab never finishes loading (may be a workos: token
prefix problem?)

🔴 Attached images (via drag and drop or the + icon to attach an image
file) aren't submitted to models.

🔴 Changing the account profile in the accounts tab (for example from
Cline External, which has budget, to Cline Internal Testing Org, which
doesn't) doesn't switch to that profile for inference.