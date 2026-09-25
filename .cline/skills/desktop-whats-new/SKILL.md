---
name: desktop-whats-new
description: Use when the team wants to catch desktop app users up on recent features with a one-time "What's new" dialog (apps/examples/desktop-app). Guides deciding whether a catch-up is warranted, picking the highlights from the changelog, writing tight copy, adding the entry to webview/lib/whats-new-content.ts, and previewing it from Settings → About. Not for individual releases — those only appear on the About page's release notes.
---

# Desktop "What's new" catch-up

Use this skill when the user asks to show desktop users what's new, catch users up on recent updates, publish a what's-new modal, or refresh the highlights in Settings → About.

> Working directory: run every command below from the repository root.

The desktop app ships every couple of days, so individual releases are never announced in-app; Settings → About always lists the bundled release notes. A **catch-up** is the exception: once enough notable features have accumulated, one dialog shows them, once, on the first launch after the update that carries it. Publishing one is a content change in a single file plus a preview, nothing else.

## How it works

- Content lives in `apps/examples/desktop-app/webview/lib/whats-new-content.ts` as `WHATS_NEW_RELEASES`, newest first. Each entry has a stable `id`, a `title`, and 3–4 `highlights` (`title`, `description`, lucide `icon`).
- `webview/lib/whats-new.ts` stores the last seen `id` in localStorage (`cline.code.whats-new.v1`). The app shell (`webview/app/page.tsx`) shows `WhatsNewDialog` when the newest id differs from the stored one; closing it, or clicking "See all changes", stores the id.
- Fresh installs never see a catch-up: completing onboarding marks the newest entry seen.
- Settings → About has a "Show what's new" button that replays the newest entry without marking it seen. That is the preview path.
- The dialog (`webview/components/whats-new-dialog.tsx`) is fixed: violet hero with an eyebrow and headline, a 2×2 grid of highlights, footer with "See all changes" and "Continue". Do not add per-entry layout options, images, or extra buttons; keep it a content change.

## Workflow

1. Decide whether a catch-up is warranted.

```sh
git log --oneline -1 -- apps/examples/desktop-app/webview/lib/whats-new-content.ts
sed -n '1,80p' apps/examples/desktop-app/CHANGELOG.md
```

Read the changelog sections since the last catch-up (the first entry's `id` is date-prefixed; the git log above shows when it landed). A catch-up needs **3–4 features a user would change how they work for** — new capabilities, not fixes or polish. If there are fewer, say so and stop; the About page already covers everything else. Never ship a catch-up for a single release or for bug fixes.

2. Pick the highlights and draft copy. Present the draft and wait for approval before editing files.

- **Headline**: 3–6 words, a headline not a sentence. Good: "Work anywhere, in parallel", "Cline now runs on Linux". Bad: "We've made a lot of improvements to the composer".
- **Highlight title**: the feature name, 1–3 words ("SSH remotes", "Worktrees").
- **Highlight description**: one sentence, under ~90 characters, leading with what the user can now do. No setup instructions, no caveats, no marketing adjectives. If a requirement is essential (e.g. "needs the gh CLI"), the changelog and docs carry it, not the dialog.
- **Icon**: a `lucide-react` icon that already exists in the codebase or the lucide set (`Network`, `GitBranchPlus`, `GitPullRequest`, `Users`, `Terminal`, `Mic`, `Cloud`, …).
- Order highlights by impact, top-left first.

3. Add the entry to the **top** of `WHATS_NEW_RELEASES` in `apps/examples/desktop-app/webview/lib/whats-new-content.ts`.

```ts
{
	id: "2026-11-cloud-and-voice", // YYYY-MM-<slug>, unique, never reused or edited later
	title: "Run it in the cloud",
	highlights: [
		{ title: "Cloud sessions", description: "…", icon: Cloud },
		// 3–4 total
	],
},
```

Import any new icons at the top of the file. The `id` is what the seen-tracking compares, so changing an existing entry's id would re-show it to everyone; changing its copy would not. Keep old entries in the array; they are harmless and document history.

4. Verify.

```sh
cd apps/examples/desktop-app
bunx vitest run webview/lib/whats-new.test.ts --config vitest.config.ts   # ids unique, newest resolves
bun run typecheck
```

Then preview in the app. From `apps/examples/desktop-app`, start `bun run dev:sidecar` and `bun run dev:web` (or `bun run dev` for the native window), open Settings → About → "Show what's new", and check both themes (General → Dark mode). Confirm no description wraps past three lines at the default font size and the headline fits on one line at 560px. Also confirm the dialog appears on launch for a returning user: clear `cline.code.whats-new.v1` from localStorage and reload.

5. Ship it. The catch-up rides the next desktop release; nothing else is needed. Do not add a changelog bullet for the catch-up itself. If the user asks to release, hand off to the `publish-desktop` skill.

## Gotchas

- A catch-up shows to **every** existing user on their first launch after the release that carries it, including users who updated through several releases. Write for someone who has not seen anything since the previous catch-up, not just the last release.
- Do not tie an entry to a specific version number in copy; the entry usually spans several.
- `WHATS_NEW_RELEASES[0]` must be the newest entry. `whats-new.test.ts` checks id uniqueness but cannot know the intended order.
- Cline Beta shares this content with stable; a catch-up added on `main` reaches beta on the next merge.
