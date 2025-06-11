### Explanation of schema and context for developers:

We're building a benchmarking system to evaluate how different LLMs perform in our autonomous coding agent, specifically focusing on their ability to generate correct search-and-replace diffs using our custom `replace_in_file` tool. The core idea is to take previously failed diff edit cases (cropped message arrays leading up to the failure), replay them across multiple models, and record detailed performance metrics like success/failure, number of search-replace blocks, line changes, latency to first token, latency to first usable diff block (critical for UX), total round-trip time, and cost. 

Each test run is versioned and tied to a specific system prompt and message array hash for reproducibility. The schema outlined here normalizes this data into four core tables — `system_prompts`, `benchmark_runs`, `benchmark_cases`, and `benchmark_results` — with proper foreign keys and indexes for fast analysis and visualization. This will allow us to compare models over time, run statistical evaluations, and surface insights into how different models behave under real-world editing tasks in our agent. The schema is designed to support repeated trials (e.g. 100x per model/case pair) and LLM model versioning (via `model_id`) for accurate tracking.

---
<pseudo_database_design>
1. `benchmark_runs`

Each run is a batch of (case × model) replays using a fixed system prompt + user message set.

runs
- run_id KEY
- created_at timestamp
- description ?string
- system_prompt_hash FOREIGN KEY

---

2. `cases`

Each case represents a testable cropped conversation (first diffedit failure, etc.).

cases
- case_id KEY
- run_id FOREIGN KEY
- created_at timestamp
- description string
- system_prompt_hash FOREIGN KEY
- task_id string
- tokens_in_context int

---

3. `results`

Each result is the outcome of replaying a case with a specific model during a specific run.

results
- result_id KEY
- run_id FOREIGN KEY
- case_id FOREIGN KEY
- model_id string
- succeeded boolean
- error_enum int
- num_edits int
- num_lines_deleted int
- num_lines_added int
- time_to_first_token_ms int
- time_to_first_edit_ms int
- time_round_trip_ms int
- cost_usd double? or REAL?
- completion_tokens
- raw_model_output string
- file_edited_hash string
- parsed_tool_call_json string
- created_at timestamp

---

4. `system_prompts`

Stores deduplicated system prompts.

system_prompts
- hash KEY
- content string
- created_at timestamp

5. `files`

Stores various deduplicated files that were extracted from the conversation history reads when running evals and applying diff edits to.

files
- hash KEY
- filepath string
- content string
- tokens int
</pseudo_database_design>
---


## 🔍 Recommended Indexes

```sql
CREATE INDEX idx_results_run_model ON benchmark_results(run_id, model_id);
CREATE INDEX idx_results_case_model ON benchmark_results(case_id, model_id);
CREATE INDEX idx_results_success ON benchmark_results(success);
```

---

## 🔒 Enable Foreign Keys in SQLite

```sql
PRAGMA foreign_keys = ON;
```

Do this after connecting to SQLite from your script.

---

## ✅ Supports:

* Multiple model replays per case
* Multiple runs with different configs
* Clean linking of prompt → run → case → result
* Full replay timing diagnostics (UX critical paths)
* Cost tracking + debug data

Let me know if you want:

* A full `.sql` file to run this
* A Python script to seed/test the schema
* Sample analysis queries or visualization pointers


