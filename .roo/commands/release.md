---
description: "Create a new release of the Roo Code extension"
argument-hint: patch | minor | major
---

1. Identify the SHA corresponding to the most recent release using GitHub CLI: `gh release view --json tagName,targetCommitish,publishedAt`
2. Analyze changes since the last release using: `gh pr list --state merged --base main --json number,title,author,url,mergedAt,closingIssuesReferences --limit 1000 -q '[.[] | select(.mergedAt > "TIMESTAMP") | {number, title, author: .author.login, url, mergedAt, issues: .closingIssuesReferences}] | sort_by(.number)'`
3. For each PR with linked issues, fetch the issue details to get the issue reporter: `gh issue view ISSUE_NUMBER --json number,author -q '{number, reporter: .author.login}'`
4. Summarize the changes. If the user did not specify, ask them whether this should be a major, minor, or patch release.
5. Create a changeset in .changeset/v[version].md instead of directly modifying package.json. The format is:

```
---
"roo-cline": patch|minor|major
---
[list of changes]
```

- Always include contributor attribution using format: (thanks @username!)
- For PRs that close issues, also include the issue number and reporter: "- Fix: Description (#123 by @reporter, PR by @contributor)"
- For PRs without linked issues, use the standard format: "- Add support for feature (thanks @contributor!)"
- Provide brief descriptions of each item to explain the change
- Order the list from most important to least important
- Example formats:
    - With issue: "- Fix: Resolve memory leak in extension (#456 by @issueReporter, PR by @prAuthor)"
    - Without issue: "- Add support for Gemini 2.5 Pro caching (thanks @contributor!)"
- CRITICAL: Include EVERY SINGLE PR in the changeset - don't assume you know which ones are important. Count the total PRs to verify completeness and cross-reference the list to ensure nothing is missed.

6. If the generate_image tool is available, create a release image at `releases/[version]-release.png`
    - The image should feature a realistic-looking kangaroo doing something human-like that relates to the main highlight of the release
    - Pass `releases/template.png` as the reference image for aspect ratio and kangaroo style
    - Add the generated image to .changeset/v[version].md before the list of changes with format: `![X.Y.Z Release - Description](/releases/X.Y.Z-release.png)`
7. If a major or minor release:
    - Ask the user what the three most important areas to highlight are in the release
    - Update the English version relevant announcement files and documentation (webview-ui/src/components/chat/Announcement.tsx, README.md, and the `latestAnnouncementId` in src/core/webview/ClineProvider.ts)
    - Ask the user to confirm that the English version looks good to them before proceeding
    - Use the new_task tool to create a subtask in `translate` mode with detailed instructions of which content needs to be translated into all supported languages (The READMEs as well as the translation strings)
8. Create a new branch for the release preparation: `git checkout -b release/v[version]`
9. Commit and push the changeset file and any documentation updates to the repository: `git add . && git commit -m "chore: add changeset for v[version]" && git push origin release/v[version]`
10. Create a pull request for the release: `gh pr create --title "Release v[version]" --body "Release preparation for v[version]. This PR includes the changeset and any necessary documentation updates." --base main --head release/v[version]`
11. The GitHub Actions workflow will automatically:
    - Create a version bump PR when changesets are merged to main
    - Update the CHANGELOG.md with proper formatting
    - Publish the release when the version bump PR is merged
