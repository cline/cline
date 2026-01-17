# Plan: Fix All 33 PRs with Unrelated Changes

## Problem
All 33 PRs from @YuriNachos contain ~200 unrelated files each because they were created from a local branch that had many commits from upstream/main. Each PR should only contain the specific fix commit.

## Solution
Create new clean branches from upstream/main, cherry-pick only the fix commit, and update each PR.

## PRs and Fix Commits

| PR # | Branch | Fix Commit | Subject |
|------|--------|------------|---------|
| 8692 | fix/6083-checkbox-whitespace-click | 7aede8945d559316caaa43dcd45e5333fb988244 | fix: checkbox toggles when clicking adjacent whitespace |
| 8691 | fix/7876-thinking-block-word-wrap | 073a9ce6e80498ebb37c89eea1e55df4a2fb379b | fix: Thinking blocks word wrap |
| 8689 | fix/5886-mcp-tool-arguments-word-wrap | 1df209e3c84ac62de95d20eedeeb4b651af000cb | fix: MCP tool arguments word wrap |
| 8688 | fix/4705-telemetry-banner-settings-tab | a4fa1aef0a5681584c18a78d2c9c2db9cde1d0a9 | fix: telemetry banner settings button |
| 8687 | fix/7807-exclude-generate-explanation-non-vscode | 555dcd03b1c85a8c23163e6d01a74910616ed9a4 | fix: exclude generate_explanation tool |
| 8686 | fix/6293-vscode-lm-model-name | ae76e81d0ba423336a420a894ba2e80f0712558e | fix: preserve full VSCode LM model name |
| 8685 | fix/6033-history-button-text | 395ee47efdfcf9956c6ae8d289a6a6db37b89376 | fix: update selected items state |
| 8684 | fix/8635-image-support-paste | d1eb5fc75d236e0f8204744e6fc7a20cc13dfc73 | fix: respect images toggle for paste |
| 8683 | fix/4705-telemetry-banner-link | e68553031f47286097d541dc2ac7520d3e31d9c0 | fix: telemetry banner settings link |
| 8682 | fix/6033-history-button-state | 6ffac4f10864db07ea8ffa287f1c27ee504fb569 | fix: update button text after delete |
| 8681 | fix/5747-windows-path-normalization | b135fcb45b9293e6b8d6db38b15faa80bf33d332 | fix: normalize Windows path separators |
| 8680 | fix/8582-git-pager-env | e81d4f12c0ec33049cdac0b208669597cca62520 | fix: set pager env vars in terminals |
| 8679 | fix/8675-focus-indicators | 2b12723b16a9d102c25668349bb503fa588b6efa | fix: add focus indicators for accessibility |
| 8608 | fix/5886-mcp-word-wrap-focused | 5d5caabf975740dee92fe045c3c999cc9d699a06 | Fix: MCP tool arguments word wrap |
| 8607 | fix/5747-duplicate-paths-windows-focused | f53f888c82cfb463cc5fb798c1bf6c9fb2e3a7ca | Fix: normalize path separators Windows |
| 8605 | fix/7091-http-alias-focused | 5cfbda5740332647ce3e95bf290f4c3daa77e5ea | Fix: add http alias for MCP |
| 8604 | fix/8030-lm-studio-endpoint-focused | e13ad8e56eb6cefc9003e57ec1b213b05a48212e | Fix: LM Studio endpoint |
| 8603 | fix/7789-quotes-paths-spaces-focused | 743a5f23ec12aa4cf71c4005d139ca093c220796 | Fix: quotes for paths with spaces |
| 8601 | fix/8273-protect-git-folder-focused | f28246947edecd253d173f0a26a21827fda6c34a | Fix: protect .git and .github folders |
| 8600 | fix/7635-mcp-timeout-focused | 1d0853a4585a8cea234963db0e9be96366a5330f | Fix: MCP timeout config |
| 8599 | fix/7564-mcp-toggle-focused | 9fc54e0d570ce4cce69669113dfed7b9f02f63c7 | Fix: MCP toggle disable race condition |
| 8598 | fix/8077-cline-force-open-focused | bdd502774c1cad8c77305446c49ada6a9ab4b734 | Fix: Cline force-opening sidebar |
| 8597 | fix/8190-taskcancel-hook-focused | 397ee39bb676a7e5e3a0822d0601b2c37563e511 | Fix: TaskCancel hook executing twice |
| 8596 | fix/7959-grpc-message-size-focused | 85a7fbbdc058e3557f66f1328327a89fc41edef6 | Fix: gRPC message size limits |
| 8595 | fix/8446-cli-tool-approval-focused | f8db50dd3c736555db168e3d3e94173b3f9315ca | Fix: CLI tool approval prompt |
| 8594 | fix/8384-openai-usage-chunk-focused | ba1be2fa45c6b1e0d669410b163df579324212f0 | Fix: OpenAI usage chunks empty choices |
| 8593 | fix/7696-bedrock-empty-description-focused | 4f9dd13c04380d1a78049a32bcd92f11869b6043 | Fix: Bedrock empty tool description |
| 8592 | fix/8342-litellm-thinking-focused | f48f528d3df90db2267f021419498e26dd8c0ed9 | Fix: LiteLLM thinking configuration |
| 8591 | fix/7581-ollama-default-url-focused | 647002ed8b141e7792f2209098fdd632195c4a9a | Fix: Ollama default base URL |
| 8590 | fix/8129-decimal-price-focused | ed98f0fc30735e58db028c76f70ea8a39d5531ae | Fix: decimal input crash in price fields |
| 8589 | fix/8256-mcp-task-progress-focused | a132ba6b4baa38af3965895c209b554447669520 | Fix: filter task_progress from MCP |
| 8588 | fix/7735-gemini-thinking-focused | 848ba55e1d97f7b182fb0c7d69d1bcbe66a35659 | Fix: Gemini thinkingBudget default |
| 8587 | fix/7534-cli-plain-mode-focused | 00b8e2f86db87546f7d204ad1b9c973b1a534d36 | Fix: CLI plain mode line breaks |

## Implementation Steps

For each PR:
1. Ensure upstream/main is up to date
2. Create a new branch `fix/{issue}-clean` from upstream/main
3. Cherry-pick the fix commit
4. Push to fork
5. Update the PR to use the new branch using `gh pr edit`

## Notes
- The fix commits are all clean and focused (2-3 files each)
- The changeset files are needed for version tracking
- After fixing, all PRs should pass CI and be ready to merge
