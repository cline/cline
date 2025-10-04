# Fix: Corrected token counting in Claude Code provider to prevent doub… #5793

Edit

Code

### Uh oh!

There was an error while loading. Please reload this page.

[Jump to bottom](https://github.com/cline/cline/pull/5793#issue-comment-box)

 

Save Cancel

Open

[ciekawy](https://github.com/ciekawy) wants to merge 2 commits into [cline:main](https://github.com/cline/cline/tree/main "cline/cline:main")

_base:_ main

Choose a base branch

Branches Tags

Loading

Loading

 

from [ciekawy:claude-code-context-tokens-fix](https://github.com/ciekawy/cline/tree/claude-code-context-tokens-fix "ciekawy/cline:claude-code-context-tokens-fix") {"props":{"processingIndicatorUrl":"/cline/cline/pull/5793/partials/processing\_indicator","repositoryId":824874689,"pullRequestId":2769689199}}

{"resolvedServerColorMode":"night"}

Open

# [Fix: Corrected token counting in Claude Code provider to prevent doub…](https://github.com/cline/cline/pull/5793#top) #5793

[ciekawy](https://github.com/ciekawy) wants to merge 2 commits into [cline:main](https://github.com/cline/cline/tree/main "cline/cline:main") from [ciekawy:claude-code-context-tokens-fix](https://github.com/ciekawy/cline/tree/claude-code-context-tokens-fix "ciekawy/cline:claude-code-context-tokens-fix")

+4 −4

[Conversation 1](https://github.com/cline/cline/pull/5793) [Commits 2](https://github.com/cline/cline/pull/5793/commits) [Checks 7](https://github.com/cline/cline/pull/5793/checks) [Files changed 1](https://github.com/cline/cline/pull/5793/files)

## Conversation

[![ciekawy](https://avatars.githubusercontent.com/u/2847952?s=60&v=4)](https://github.com/ciekawy)

Sorry, something went wrong.

Quote reply

### Uh oh!

There was an error while loading. Please reload this page.

### 

![@ciekawy](https://avatars.githubusercontent.com/u/2847952?s=48&v=4) **[ciekawy](https://github.com/ciekawy)** commented [Aug 24, 2025](https://github.com/cline/cline/pull/5793#issue-3349315014) •

edited by ellipsis-dev bot

Loading

### Uh oh!

There was an error while loading. Please reload this page.

### Related Issue

**Issue:** [#5792](https://github.com/cline/cline/issues/5792)

### Description

The Claude Code provider was incorrectly overwriting token counts instead of accumulating them across multiple assistant messages within a single response stream. This caused significantly inflated token usage reporting, with Cline displaying much higher context usage than actual consumption.

**The fix** restores proper token accumulation logic by reverting to using `+=` operators instead of `=` for all token count fields (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`).

### Test Procedure

**Testing approach:**

-   Used the `ccusage` CLI tool to measure actual token consumption by Claude Code
-   Compared Cline's reported context usage against actual CLI usage
-   Tested both before and after the fix across multiple conversation turns

**Results:**

-   **Before fix**: Cline reported significantly inflated token counts compared to actual usage
-   **After fix**: Token counts match `ccusage` measurements exactly
-   Token deltas between requests now align perfectly with CLI measurements

**Confidence:** The fix has been validated to ensure accurate token reporting that matches the underlying CLI's actual consumption.

### Type of Change

-   [x]  🐛 Bug fix (non-breaking change which fixes an issue)
-   [ ]  ✨ New feature (non-breaking change which adds functionality)
-   [ ]  💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
-   [ ]  ♻️ Refactor Changes
-   [ ]  💅 Cosmetic Changes
-   [ ]  📚 Documentation update
-   [ ]  🏃 Workflow Changes

### Pre-flight Checklist

-   [x]  Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
-   [ ]  Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
-   [ ]  I have created a changeset using `npm run changeset` (required for user-facing changes)
-   [ ]  I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Screenshots

Not applicable - backend token counting fix with no UI changes.

### Additional Notes

A separate investigation revealed up to ~20k token overhead between Claude Code and direct Anthropic API providers. This appears to be related to how the Claude Code CLI handles caching and session management. This overhead remains unaddressed by this fix and may warrant future investigation.

___

Important

Fixes token counting in `ClaudeCodeHandler` by changing assignment to accumulation for token fields, ensuring accurate usage reporting.

-   **Behavior**:
    -   Fixes token counting in `ClaudeCodeHandler` in `claude-code.ts` by changing `=` to `+=` for `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheWriteTokens`.
    -   Ensures token counts accumulate across multiple assistant messages instead of being overwritten.
-   **Testing**:
    -   Validated using `ccusage` CLI tool to compare reported and actual token usage.
    -   Confirmed accurate token reporting post-fix.

<sup>This description was created by </sup> [![Ellipsis](https://camo.githubusercontent.com/34bf9170ce9970063622a6598321f3ac85ed9e532670205236a10469e231eb1d/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f456c6c69707369732d626c75653f636f6c6f723d313735313733)](https://www.ellipsis.dev?ref=cline%2Fcline&utm_source=github&utm_medium=referral) <sup> for <a class="commit-link" data-hovercard-type="commit" data-hovercard-url="https://github.com/cline/cline/commit/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8/hovercard" href="https://github.com/cline/cline/commit/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8" aria-keyshortcuts="Alt+ArrowUp"><tt>5f51dd3</tt></a>. You can <a href="https://app.ellipsis.dev/cline/settings/summaries" rel="nofollow">customize</a> this summary. It will automatically update as commits are pushed.</sup>

Write Preview

Heading

Bold

Italic

Quote

Code

Link

___

Numbered list

Unordered list

Task list

___

Attach files

Mention

Reference

Saved replies

Slash commands

Menu

-   Heading
-   Bold
-   Italic
-   Quote
-   Code
-   Link

-   Numbered list
-   Unordered list
-   Task list

-   Attach files
-   Mention
-   Reference
-   Saved replies
-   Slash commands

# Select a reply

Loading

### Uh oh!

There was an error while loading. Please reload this page.

[Create a new saved reply](https://github.com/settings/replies?return_to=1)

The content you are editing has changed. Please copy your edits and refresh the page.

   Slash commands

Preview

Loading

Slash commands

Preview

#### An unexpected error has occurred

\### Related Issue \*\*Issue:\*\* #5792 ### Description The Claude Code provider was incorrectly overwriting token counts instead of accumulating them across multiple assistant messages within a single response stream. This caused significantly inflated token usage reporting, with Cline displaying much higher context usage than actual consumption. \*\*The fix\*\* restores proper token accumulation logic by reverting to using \`+=\` operators instead of \`=\` for all token count fields (\`inputTokens\`, \`outputTokens\`, \`cacheReadTokens\`, \`cacheWriteTokens\`). ### Test Procedure \*\*Testing approach:\*\* - Used the \`ccusage\` CLI tool to measure actual token consumption by Claude Code - Compared Cline's reported context usage against actual CLI usage - Tested both before and after the fix across multiple conversation turns \*\*Results:\*\* - \*\*Before fix\*\*: Cline reported significantly inflated token counts compared to actual usage - \*\*After fix\*\*: Token counts match \`ccusage\` measurements exactly - Token deltas between requests now align perfectly with CLI measurements \*\*Confidence:\*\* The fix has been validated to ensure accurate token reporting that matches the underlying CLI's actual consumption. ### Type of Change - \[x\] 🐛 Bug fix (non-breaking change which fixes an issue) - \[ \] ✨ New feature (non-breaking change which adds functionality) - \[ \] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected) - \[ \] ♻️ Refactor Changes - \[ \] 💅 Cosmetic Changes - \[ \] 📚 Documentation update - \[ \] 🏃 Workflow Changes ### Pre-flight Checklist - \[x\] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs) - \[ \] Tests are passing (\`npm test\`) and code is formatted and linted (\`npm run format && npm run lint\`) - \[ \] I have created a changeset using \`npm run changeset\` (required for user-facing changes) - \[ \] I have reviewed \[contributor guidelines\](https://github.com/cline/cline/blob/main/CONTRIBUTING.md) ### Screenshots Not applicable - backend token counting fix with no UI changes. ### Additional Notes A separate investigation revealed up to ~20k token overhead between Claude Code and direct Anthropic API providers. This appears to be related to how the Claude Code CLI handles caching and session management. This overhead remains unaddressed by this fix and may warrant future investigation. <!-- ELLIPSIS\_HIDDEN --> ---- > \[!IMPORTANT\] > Fixes token counting in \`ClaudeCodeHandler\` by changing assignment to accumulation for token fields, ensuring accurate usage reporting. > > - \*\*Behavior\*\*: > - Fixes token counting in \`ClaudeCodeHandler\` in \`claude-code.ts\` by changing \`=\` to \`+=\` for \`inputTokens\`, \`outputTokens\`, \`cacheReadTokens\`, and \`cacheWriteTokens\`. > - Ensures token counts accumulate across multiple assistant messages instead of being overwritten. > - \*\*Testing\*\*: > - Validated using \`ccusage\` CLI tool to compare reported and actual token usage. > - Confirmed accurate token reporting post-fix. > > <sup>This description was created by </sup>\[<img alt="Ellipsis" src="https://img.shields.io/badge/Ellipsis-blue?color=175173">\](https://www.ellipsis.dev?ref=cline%2Fcline&utm\_source=github&utm\_medium=referral)<sup> for 5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8. You can \[customize\](https://app.ellipsis.dev/cline/settings/summaries) this summary. It will automatically update as commits are pushed.</sup> <!-- ELLIPSIS\_HIDDEN -->

We don’t support that file type.

Try again with GIF, JPEG, JPG, MOV, MP4, PNG, SVG, WEBM, CPUPROFILE, CSV, DMP, DOCX, FODG, FODP, FODS, FODT, GZ, JSON, JSONC, LOG, MD, ODF, ODG, ODP, ODS, ODT, PATCH, PDF, PPTX, TGZ, TXT, XLS, XLSX or ZIP.

Attaching documents requires write permission to this repository.

Try again with GIF, JPEG, JPG, MOV, MP4, PNG, SVG, WEBM, CPUPROFILE, CSV, DMP, DOCX, FODG, FODP, FODS, FODT, GZ, JSON, JSONC, LOG, MD, ODF, ODG, ODP, ODS, ODT, PATCH, PDF, PPTX, TGZ, TXT, XLS, XLSX or ZIP.

This file is empty.

Try again with a file that’s not empty.

This file is hidden.

Try again with another file.

Something went really wrong, and we can’t process that file.

Try again.

Nothing to preview

Cancel Update comment

 -   👍
-   👎
-   😄
-   🎉
-   😕
-   ❤️
-   🚀
-   👀

 

🚀 1 ellipsis-dev\[bot\] reacted with rocket emoji

All reactions

-   🚀 1 reaction

[![@ciekawy](https://avatars.githubusercontent.com/u/2847952?s=40&v=4)](https://github.com/ciekawy)

`[Fix: Corrected token counting in Claude Code provider to prevent doub…](https://github.com/cline/cline/pull/5793/commits/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8 "Fix: Corrected token counting in Claude Code provider to prevent double-counting of cache tokens.")` …

Loading

Loading status checks…

### Uh oh!

There was an error while loading. Please reload this page.

`[5f51dd3](https://github.com/cline/cline/pull/5793/commits/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8)`

```
…le-counting of cache tokens.
```

[![@changeset-bot](https://avatars.githubusercontent.com/in/28616?s=80&v=4)](https://github.com/apps/changeset-bot) [![changeset-bot](https://avatars.githubusercontent.com/in/28616?s=40&u=dfac8d20bd8180eee325b15beb2569b9b6ae4846&v=4)](https://github.com/apps/changeset-bot)

Sorry, something went wrong.

Quote reply

### Uh oh!

There was an error while loading. Please reload this page.

### 

**[changeset-bot](https://github.com/apps/changeset-bot) bot** commented [Aug 24, 2025](https://github.com/cline/cline/pull/5793#issuecomment-3217950601)

<table class="d-block user-select-contain" data-paste-markdown-skip=""><tbody class="d-block"><tr class="d-block"><td class="d-block comment-body markdown-body  js-comment-body"><h3 dir="auto"><g-emoji class="g-emoji" alias="warning">⚠️</g-emoji> No Changeset found</h3><p dir="auto">Latest commit: <a class="commit-link" data-hovercard-type="commit" data-hovercard-url="https://github.com/cline/cline/commit/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8/hovercard" href="https://github.com/cline/cline/commit/5f51dd3961bd4c010f0d0868ea4490a7d92bb7b8" aria-keyshortcuts="Alt+ArrowUp"><tt>5f51dd3</tt></a></p><p dir="auto">Merging this PR will not cause a version bump for any packages. If these changes should not result in a new version, you're good to go. <strong>If these changes should result in a version bump, you need to add a changeset.</strong></p><details><summary>This PR includes no changesets</summary><p dir="auto">When changesets are added to this PR, you'll see the packages that this PR includes changesets for and the associated semver types</p></details><p dir="auto"><a href="https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md">Click here to learn what changesets are, and how to add one</a>.</p><p dir="auto"><a href="https://github.com/ciekawy/cline/new/claude-code-context-tokens-fix?filename=.changeset/brave-starfishes-smoke.md&amp;value=---%0A%22claude-dev%22%3A%20patch%0A---%0A%0AFix%3A%20Corrected%20token%20counting%20in%20Claude%20Code%20provider%20to%20prevent%20doub%E2%80%A6%0A">Click here if you're a maintainer who wants to add a changeset to this PR</a></p></td></tr></tbody></table>

  -   👍
-   👎
-   😄
-   🎉
-   😕
-   ❤️
-   🚀
-   👀

  

All reactions

Sorry, something went wrong.

### Uh oh!

There was an error while loading. Please reload this page.

[![@ciekawy](https://avatars.githubusercontent.com/u/2847952?s=40&v=4)](https://github.com/ciekawy)

`[Merge branch 'main' into claude-code-context-tokens-fix](https://github.com/cline/cline/pull/5793/commits/c9270f02af963639adc49bc4e8ed442c4c2abe6f "Merge branch 'main' into claude-code-context-tokens-fix")`

Verified

# Verified

This commit was created on GitHub.com and signed with GitHub’s **verified signature**.

GPG key ID: B5690EEEBB952194

Verified

[Learn about vigilant mode](https://docs.github.com/github/authenticating-to-github/displaying-verification-statuses-for-all-of-your-commits)

Loading

Loading status checks…

### Uh oh!

There was an error while loading. Please reload this page.

`[c9270f0](https://github.com/cline/cline/pull/5793/commits/c9270f02af963639adc49bc4e8ed442c4c2abe6f)`

[dtrugman](https://github.com/dtrugman) pushed a commit to dtrugman/cline that referenced this pull request [Aug 25, 2025](https://github.com/cline/cline/pull/5793#ref-commit-a92ee56)

[![@chrarnoldus](https://avatars.githubusercontent.com/u/12196001?s=40&v=4)](https://github.com/chrarnoldus)

`[Format time in ISO 8601 (](https://github.com/dtrugman/cline/commit/a92ee567df44806908dc67cb18519e9e0e7f7a09 "Format time in ISO 8601 (#5793)")[cline#5793](https://github.com/cline/cline/pull/5793)[)](https://github.com/dtrugman/cline/commit/a92ee567df44806908dc67cb18519e9e0e7f7a09 "Format time in ISO 8601 (#5793)")`

Verified

# Verified

This commit was created on GitHub.com and signed with GitHub’s **verified signature**.

GPG key ID: B5690EEEBB952194

Verified

[Learn about vigilant mode](https://docs.github.com/github/authenticating-to-github/displaying-verification-statuses-for-all-of-your-commits)

`[a92ee56](https://github.com/dtrugman/cline/commit/a92ee567df44806908dc67cb18519e9e0e7f7a09)`

[![JicLotus](https://avatars.githubusercontent.com/u/13896764?s=60&v=4)](https://github.com/JicLotus)

**[JicLotus](https://github.com/JicLotus)** reviewed [Aug 25, 2025](https://github.com/cline/cline/pull/5793#pullrequestreview-3152439433)

[View reviewed changes](https://github.com/cline/cline/pull/5793/files/c9270f02af963639adc49bc4e8ed442c4c2abe6f)

[src/core/api/providers/claude-code.ts](https://github.com/cline/cline/pull/5793/files/c9270f02af963639adc49bc4e8ed442c4c2abe6f#diff-2aae9d46a80e6bfbe2dc363530fa7b0f1e80932d1597e74bb0fe7b05b5fbf1b5)

Comment on lines +121 to +124

<table class="diff-table tab-size js-diff-table" data-tab-size="4" data-paste-markdown-skip=""><tbody><tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="121" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition"><span class="pl-s1">usage</span><span class="pl-kos">.</span><span class="pl-c1">inputTokens</span> <span class="pl-c1">=</span> <span class="pl-s1">message</span><span class="pl-kos">.</span><span class="pl-c1">usage</span><span class="pl-kos">.</span><span class="pl-c1">input_tokens</span></span></td></tr><tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="122" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition"><span class="pl-s1">usage</span><span class="pl-kos">.</span><span class="pl-c1">outputTokens</span> <span class="pl-c1">=</span> <span class="pl-s1">message</span><span class="pl-kos">.</span><span class="pl-c1">usage</span><span class="pl-kos">.</span><span class="pl-c1">output_tokens</span></span></td></tr><tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="123" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition"><span class="pl-s1">usage</span><span class="pl-kos">.</span><span class="pl-c1">cacheReadTokens</span> <span class="pl-c1">=</span> <span class="pl-s1">message</span><span class="pl-kos">.</span><span class="pl-c1">usage</span><span class="pl-kos">.</span><span class="pl-c1">cache_read_input_tokens</span> <span class="pl-c1">||</span> <span class="pl-c1">0</span></span></td></tr><tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="124" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition"><span class="pl-s1">usage</span><span class="pl-kos">.</span><span class="pl-c1">cacheWriteTokens</span> <span class="pl-c1">=</span> <span class="pl-s1">message</span><span class="pl-kos">.</span><span class="pl-c1">usage</span><span class="pl-kos">.</span><span class="pl-c1">cache_creation_input_tokens</span> <span class="pl-c1">||</span> <span class="pl-c1">0</span></span></td></tr></tbody></table>

Sorry, something went wrong.

Quote reply

### Uh oh!

There was an error while loading. Please reload this page.

### 

![@JicLotus](https://avatars.githubusercontent.com/u/13896764?s=48&v=4) **[JicLotus](https://github.com/JicLotus)** [Aug 25, 2025](https://github.com/cline/cline/pull/5793#discussion_r2298713966)

There was a problem hiding this comment.

### Choose a reason for hiding this comment

The reason will be displayed to describe this comment to others. [Learn more](https://docs.github.com/articles/managing-disruptive-comments/#hiding-a-comment).

 Choose a reason Spam Abuse Off Topic Outdated Duplicate Resolved Hide comment

nit: maybe?

```
usage.inputTokens = message.usage?.input_tokens ?? 0;
usage.outputTokens = message.usage?.output_tokens ?? 0;
usage.cacheReadTokens = message.usage?.cache_read_input_tokens ?? 0;
usage.cacheWriteTokens = message.usage?.cache_creation_input_tokens ?? 0;
```

Refresh and try again.

Sorry, something went wrong.

### Uh oh!

There was an error while loading. Please reload this page.

 -   👍
-   👎
-   😄
-   🎉
-   😕
-   ❤️
-   🚀
-   👀

 

All reactions

![@ciekawy](https://avatars.githubusercontent.com/u/2847952?s=48&v=4)

Reply...

        Comment 

Write Preview

Suggest changes

___

Heading

Bold

Italic

Quote

Code

Link

___

Numbered list

Unordered list

Task list

___

Attach files

Mention

Reference

Saved replies

Slash commands

Menu

-   Suggest changes

-   Heading
-   Bold
-   Italic
-   Quote
-   Code
-   Link

-   Numbered list
-   Unordered list
-   Task list

-   Attach files
-   Mention
-   Reference
-   Saved replies
-   Slash commands

# Select a reply

Loading

### Uh oh!

There was an error while loading. Please reload this page.

[Create a new saved reply](https://github.com/settings/replies?return_to=1)

There was an error creating your PullRequest.

Slash commands

Preview

Loading

Slash commands

Preview

#### An unexpected error has occurred

Leave a comment

We don’t support that file type.

Try again with GIF, JPEG, JPG, MOV, MP4, PNG, SVG, WEBM, CPUPROFILE, CSV, DMP, DOCX, FODG, FODP, FODS, FODT, GZ, JSON, JSONC, LOG, MD, ODF, ODG, ODP, ODS, ODT, PATCH, PDF, PPTX, TGZ, TXT, XLS, XLSX or ZIP.

Attaching documents requires write permission to this repository.

Try again with GIF, JPEG, JPG, MOV, MP4, PNG, SVG, WEBM, CPUPROFILE, CSV, DMP, DOCX, FODG, FODP, FODS, FODT, GZ, JSON, JSONC, LOG, MD, ODF, ODG, ODP, ODS, ODT, PATCH, PDF, PPTX, TGZ, TXT, XLS, XLSX or ZIP.

This file is empty.

Try again with a file that’s not empty.

This file is hidden.

Try again with another file.

Something went really wrong, and we can’t process that file.

Try again.

[Markdown is supported](https://docs.github.com/github/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)

Paste, drop, or click to add files

        

Nothing to preview

 Comment

Cancel

 

Resolve conversation

[![@JicLotus](https://avatars.githubusercontent.com/u/13896764?s=80&u=709bf59202f4d6ec49b9dde403485e5464673649&v=4)](https://github.com/JicLotus)

Sorry, something went wrong.

Quote reply

### Uh oh!

There was an error while loading. Please reload this page.

### 

**[JicLotus](https://github.com/JicLotus)** commented [Aug 25, 2025](https://github.com/cline/cline/pull/5793#issuecomment-3221165374)

<table class="d-block user-select-contain" data-paste-markdown-skip=""><tbody class="d-block"><tr class="d-block"><td class="d-block comment-body markdown-body  js-comment-body"><p dir="auto">Hello <a class="user-mention notranslate" data-hovercard-type="user" data-hovercard-url="/users/ciekawy/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="https://github.com/ciekawy" aria-keyshortcuts="Alt+ArrowUp">@ciekawy</a> thanks so much for these changes. Aside from my minor comment, could you create a new file at <code class="notranslate">providers/__tests__/claude-code.test.ts</code> and add a unit test there? I will also refer this to <a class="user-mention notranslate" data-hovercard-type="user" data-hovercard-url="/users/BarreiroT/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="https://github.com/BarreiroT" aria-keyshortcuts="Alt+ArrowUp">@BarreiroT</a> for approval.</p></td></tr></tbody></table>

  -   👍
-   👎
-   😄
-   🎉
-   😕
-   ❤️
-   🚀
-   👀

  

All reactions

Sorry, something went wrong.

### Uh oh!

There was an error while loading. Please reload this page.

[![@JicLotus](https://avatars.githubusercontent.com/u/13896764?s=40&u=709bf59202f4d6ec49b9dde403485e5464673649&v=4)](https://github.com/JicLotus) [JicLotus](https://github.com/JicLotus) requested a review from [BarreiroT](https://github.com/BarreiroT) [August 25, 2025 19:43](https://github.com/cline/cline/pull/5793#event-19327345257)

[![@dcbartlett](https://avatars.githubusercontent.com/u/1077050?s=40&u=6e63d955a89098e236a30ea67aab8e2277a40a81&v=4)](https://github.com/dcbartlett) [dcbartlett](https://github.com/dcbartlett) added [Triaged](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3ATriaged) [size:XS](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3Asize%3AXS) This PR changes 0-9 lines, ignoring generated files. [P1](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3AP1) and removed [Triaged](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3ATriaged) [size:XS](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3Asize%3AXS) This PR changes 0-9 lines, ignoring generated files. [P1](https://github.com/cline/cline/issues?q=state%3Aopen%20label%3AP1) labels [Aug 26, 2025](https://github.com/cline/cline/pull/5793#event-19334118676)

[![BarreiroT](https://avatars.githubusercontent.com/u/52393857?s=60&v=4)](https://github.com/BarreiroT)

**[BarreiroT](https://github.com/BarreiroT)** approved these changes [Aug 26, 2025](https://github.com/cline/cline/pull/5793#pullrequestreview-3155130357)

[View reviewed changes](https://github.com/cline/cline/pull/5793/files/c9270f02af963639adc49bc4e8ed442c4c2abe6f)

Sorry, something went wrong.

Quote reply

### Uh oh!

There was an error while loading. Please reload this page.

Contributor

### 

![@BarreiroT](https://avatars.githubusercontent.com/u/52393857?s=48&v=4) **[BarreiroT](https://github.com/BarreiroT)** left a comment

[](https://github.com/cline/cline/pull/5793#pullrequestreview-3155130357)

There was a problem hiding this comment.

### Choose a reason for hiding this comment

The reason will be displayed to describe this comment to others. [Learn more](https://docs.github.com/articles/managing-disruptive-comments/#hiding-a-comment).

 Choose a reason Spam Abuse Off Topic Outdated Duplicate Resolved Hide comment

LGTM beyond the `nit` comment. Having tests would be great, but considering I only wrote tests for the `run` logic, I think it's beyond the scope of this PR. They are more than welcome if you have the time to do it. Otherwise, I will do so in a later PR.  
I tested it locally and confirmed the usage aligns with the usage reported by `ccusage`.

Thank you for your contribution!

Sorry, something went wrong.

### Uh oh!

There was an error while loading. Please reload this page.

 -   👍
-   👎
-   😄
-   🎉
-   😕
-   ❤️
-   🚀
-   👀