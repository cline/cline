# SDK Migration Caveats & Known Issues

Tracking issues found during the migration from the legacy inference system to the ClineCore SDK.

## Status Legend
- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🟢 **Fixed** — resolved

---

Under accounts, the when logged in the "current balance" is ---- and
the reload button does nothing.

Under accounts, the "cline environment" dropdown doesn't change from
production when you select "staging" or "local".

Under accounts, the logout button does nothing.

Reportedly under accounts you can't sign in.

When you have a low credit balance, even after you change accounts
(for example from one "org" to another) or refreshing you keep getting
an error "Insufficient balance. Your Cline Credits balance ..."

In chat, a chat response has a "copy" button that is
obscured/partially obscured by the last generated code block. In the
classic extension, this appears with enough space around it to be
visible.

The OpenAI compatible provider has the "6 consecutive api_error"
problem that we encountered with Ollama. You may need to use Ollama as
your mock OpenAI compatible provider to reproduce and verify this
one. (I think Ollama has decent OpenAI API fidelity, you may need to
research this.)

In the history section, you can't mark chats as favorites.

Banners (for example "Try Claude Sonnet 4.6") can't be dismissed.
