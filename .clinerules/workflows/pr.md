# Workflow: Create Pull Request

This workflow outlines the steps for creating a pull request (PR) after development work is completed on a feature branch. The AI should follow these steps precisely.

## Prerequisites:
-   Work is completed on the current feature branch.
-   All changes are saved.

## 1. Add Changes for Commit

Stage all relevant changes for the commit.
- **Action:** Execute `git add .` to stage all changes in the current directory.
- **Alternative:** If specific files need to be staged, the AI can ask the user or attempt to identify them based on the work done. For example, `git add src/feature-file.ts webview-ui/src/components/NewComponent.tsx`.

## 2. Create a Changeset (If Applicable)

If the project uses `changesets` (e.g., `npx changeset` or `yarn changeset`), create a new changeset.
- **Action:** Check for `changeset` CLI in `package.json` scripts or as a dev dependency.
- **If `changesets` is used:**
    - Execute `npx changeset` (or `yarn changeset`).
    - The AI should guide the user through the changeset prompts if possible, or inform the user that they will need to complete the prompts in their terminal.
    - **AI Note:** The AI might need to describe what a changeset is and why it's being created (e.g., "This project uses changesets to manage versioning and changelogs. I'll run the command to create one. Please follow the prompts in your terminal to describe the changes.").
- **If `changesets` is not used:** Skip this step.

## 3. Commit Changes

Commit the staged changes with a descriptive message.
- **Action:** Ask the user for a commit message or suggest one based on the task.
- **Guidance for AI:** Follow conventional commit message format if the project seems to use it (e.g., `feat: add user login functionality`, `fix: resolve issue with form validation`).
- **Action:** Execute `git commit -m "<commit-message>"`.
  *If changesets were added in the previous step, the commit message could be something like `chore: add changeset` or the AI can ask the user for a more specific message.*

## 4. Rebase Main Branch onto Feature Branch

Ensure the feature branch is up-to-date with the latest changes from the main branch.
- **Action:** Identify the main branch (e.g., `main` or `master`).
- **Action:** Execute `git fetch origin <main-branch-name>`.
- **Action:** Execute `git rebase origin/<main-branch-name>`.
- **Conflict Resolution:** If rebase conflicts occur:
    - Inform the user: "Rebase conflicts detected. Please resolve them in your editor. After resolving, run `git rebase --continue`. If you get stuck, you can run `git rebase --abort` to cancel the rebase."
    - The AI should pause and wait for the user to confirm conflicts are resolved before proceeding.

## 5. Push Changes

Push the (potentially rebased) feature branch to the remote repository.
- **Action:** Get the current branch name: `git branch --show-current`.
- **Action:** Execute `git push origin <current-branch-name> --force-with-lease`.
  *`--force-with-lease` is generally safer than `--force` when pushing rebased branches.*

## 6. Create Pull Request

Open a pull request on the repository hosting platform (e.g., GitHub, GitLab).
- **Action:** Use the `gh` CLI if available and authenticated.
    - **Check for `gh`:** `gh --version`.
    - **Check auth status:** `gh auth status`. If not authenticated, inform the user.
    - **Create PR:** `gh pr create --fill --web` (opens in web browser to finalize) or `gh pr create --title "<PR Title>" --body "<PR Body>"`.
    - The AI should ask the user for a PR title and body, or suggest them based on the commit messages/changesets.
- **Alternative (if `gh` CLI is not available/configured):**
    - Provide the user with a link to create the PR. The link format depends on the platform (e.g., GitHub: `https://github.com/<owner>/<repo>/compare/<main-branch>...<feature-branch>?expand=1`). The AI will need to infer owner/repo from `git remote -v`.
    - Instruct the user: "Please open the following link in your browser to create the Pull Request: [link]"

## AI Instructions & Considerations:

*   **Error Handling:** If any Git command fails (other than expected rebase conflicts), report the error to the user and ask for guidance.
*   **User Interaction:** Clearly communicate each step. Wait for user input for commit messages, PR titles/bodies, and confirmation of conflict resolution.
*   **Platform Specifics:** Be mindful that `gh` is GitHub-specific. If the remote URL suggests GitLab or Bitbucket, the PR creation step will need to be adjusted (e.g., providing a generic link or different CLI commands if known).
*   **Changeset Tooling:** The exact command for changesets might vary (`yarn changeset`, `pnpm changeset`, etc.). The AI should try to infer this from `package.json`.
*   **Tool Usage:** Use the `execute_command` tool for Git and `gh` operations. Set `requires_approval` to `true` for commands that modify state or create PRs.
*   **Idempotency:** If a PR already exists for the branch, `gh pr create` might fail or offer to update. The AI should handle this gracefully.
