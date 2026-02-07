# Prompt Manifest + Prompt Override Changes

## Goal
Make it easy to:
1. Know exactly which prompt was used for a run.
2. Switch prompt variants/profiles without changing model/provider settings.
3. Keep run-to-run comparisons reproducible.

## High-Level Flow
```mermaid
flowchart LR
  U["User runs cline"] --> CLI["CLI options\n--prompt-profile\n--prompt-file"]
  CLI --> ENV["Set env hints\nCLINE_PROMPT_PROFILE\nCLINE_PROMPT_FILE"]
  ENV --> TASK["Task prompt resolver"]
  TASK --> MAN["Build Prompt Manifest\nprofile id, file path, fingerprints"]
  TASK --> CTX["SystemPromptContext\nactivePromptProfile*"]
  CTX --> BUILDER["PromptBuilder (existing)"]
  BUILDER --> API["Provider API createMessage"]
  MAN --> LOG["Emit one-time info messages\nat first request"]
  TASK --> ART["Optional prompt artifacts\nmanifest + profile + system prompt"]
```

## What Changed

### 1) CLI: new runtime controls
File: `cli/src/index.ts`

- Added optional flags on both `cline task` and default interactive command:
  - `--prompt-profile <id>`
  - `--prompt-file <path>`
- Added prompt override preparation that sets:
  - `CLINE_PROMPT_PROFILE`
  - `CLINE_PROMPT_FILE`
- Preserved piping behavior by avoiding extra stdout logs from this step.

### 2) Task runtime: prompt manifest resolution + one-time identity signal
File: `src/core/task/index.ts`

- Added prompt override metadata resolver that:
  - reads `CLINE_PROMPT_PROFILE` and `CLINE_PROMPT_FILE`
  - loads prompt file contents when provided
  - computes a profile fingerprint (`sha256`, short)
  - creates an instruction block for prompt injection
- At first API request only, emits info messages with:
  - active prompt profile id
  - prompt source file (if set)
  - prompt profile fingerprint
  - selected prompt variant family
  - final system prompt fingerprint
  - provider and model

### 3) Prompt context: carry active profile metadata
File: `src/core/prompts/system-prompt/types.ts`

- Extended `SystemPromptContext` with:
  - `activePromptProfileId`
  - `activePromptProfileFilePath`
  - `activePromptProfileFingerprint`
  - `activePromptProfileInstructions`

### 4) Prompt assembly: inject profile instructions
File: `src/core/prompts/system-prompt/components/user_instructions.ts`

- Extended `buildUserInstructions(...)` to include `activePromptProfileInstructions`.
- This means prompt-file content is included via existing user-instructions composition path.

### 5) Optional prompt artifact dump (exact prompt capture)
File: `src/core/task/index.ts`

- Added optional artifact writing to persist exactly what prompt was sent.
- Guarded by env flag:
  - `CLINE_WRITE_PROMPT_ARTIFACTS=1` (also accepts `true`/`yes`)
- Optional output dir:
  - `CLINE_PROMPT_ARTIFACT_DIR=/path/to/dir`
  - defaults to `<cwd>/.cline-prompt-artifacts`
- On first request of a task run, writes:
  - `<basename>.manifest.json`
  - `<basename>.system_prompt.md`
  - `<basename>.profile_prompt.md` (when profile instructions exist)

## Practical Usage

### Override prompt profile label only
```bash
cline task "Fix failing tests" --prompt-profile exp-v1
```

### Override with a prompt file
```bash
cline task "Fix failing tests" --prompt-profile exp-v2 --prompt-file ./prompts/exp-v2.md
```

### Persist exact prompts as artifacts
```bash
CLINE_WRITE_PROMPT_ARTIFACTS=1 \
CLINE_PROMPT_ARTIFACT_DIR=./prompt-artifacts \
cline task "Fix failing tests" --prompt-profile exp-v2 --prompt-file ./prompts/exp-v2.md
```

## Reproducibility Impact

For each run, you now get an explicit runtime identity signal that can be logged with your eval/benchmark metadata:
- Prompt profile id
- Prompt source path (if used)
- Prompt profile fingerprint
- System prompt fingerprint
- Variant family
- Provider/model

And with artifact dumping enabled, you can inspect the exact rendered prompt text for audit/debugging.

## Validation
- Type-check passed: `npm run -s check-types`
- CLI build passed: `npm run -s cli:build`
- Manual E2E against OpenRouter (`anthropic/claude-opus-4.5`) verified:
  - profile-v1 and profile-v2 runs produce distinct output files
  - manifest/profile/system prompt artifact files are written
