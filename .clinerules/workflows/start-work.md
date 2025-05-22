# Workflow: Start New Work

This workflow outlines the steps for starting a new piece of work or feature development. The AI should follow these steps precisely.

## 1. Ensure a Clean Working Directory

Before starting, ensure there are no uncommitted changes.
- **Action:** Execute `git status` to check for modifications.
- **If changes exist:** Ask the user if they want to stash them (`git stash`) or commit them. Proceed only when the working directory is clean.

## 2. Switch to the Main Branch

Switch to the primary development branch (commonly `main` or `master`).
- **Action:** Execute `git checkout main`.
  *If `main` doesn't exist, try `master`. If neither exists, ask the user for the correct main branch name.*

## 3. Pull Latest Changes

Update the local main branch with the latest changes from the remote repository.
- **Action:** Execute `git pull origin main` (or the identified main branch name).
  *Ensure this step completes successfully before proceeding.*

## 4. Create a New Feature Branch

Create a new branch for the work. The branch name should be descriptive.
- **Action:** Ask the user for a concise branch name (e.g., `feature/user-authentication` or `fix/login-bug`).
- **Guidance for AI:** Suggest a branch name based on the task if the user doesn't provide one.
- **Example format:** `feature/<short-description>`, `fix/<short-description>`, `chore/<short-description>`.
- **Action:** Execute `git checkout -b <branch-name>`.

## 5. Confirm Branch Creation

Verify that the new branch has been created and is currently active.
- **Action:** Execute `git branch --show-current`.
- **Expected Output:** The name of the newly created branch.

## 6. Understand the Task

Once the branch is set up, clarify the development task.
- **Action:** Ask the user: "Your new branch `<branch-name>` is ready. What would you like to build or work on?"

## AI Instructions & Considerations:

*   **Error Handling:** If any Git command fails, report the error to the user and ask for guidance before retrying or proceeding.
*   **User Interaction:** Clearly communicate each step being performed. Wait for user confirmation or input where specified (e.g., branch name, task description).
*   **Project Context:** Be aware of the project structure (from `environment_details`) to understand potential impacts of the new work.
*   **Idempotency:** If the workflow is re-run and the branch already exists, ask the user if they want to switch to it or delete and recreate it.
*   **Tool Usage:** Use the `execute_command` tool for all Git operations. Set `requires_approval` to `false` for read-only commands like `git status` or `git branch --show-current`, and `true` for commands that modify state like `git checkout`, `git pull`, `git stash`.
