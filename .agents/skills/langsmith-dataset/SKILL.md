---
name: langsmith-dataset
description: "INVOKE THIS SKILL when creating evaluation datasets, uploading datasets to LangSmith, or managing existing datasets. Covers dataset types (final_response, single_step, trajectory, RAG), CLI management commands, SDK-based creation, and example management. Uses the langsmith CLI tool."
---

<oneliner>
Create, manage, and upload evaluation datasets to LangSmith for testing and validation.
</oneliner>

<setup>
Environment Variables

```bash
LANGSMITH_API_KEY=lsv2_pt_your_api_key_here          # Required
LANGSMITH_PROJECT=your-project-name                   # Check this to know which project has traces
LANGSMITH_WORKSPACE_ID=your-workspace-id              # Optional: for org-scoped keys
```

**IMPORTANT:** Always check the environment variables or `.env` file for `LANGSMITH_PROJECT` before querying or interacting with LangSmith. This tells you which project contains the relevant traces and data. If the LangSmith project is not available, use your best judgement to identify the right one.

Python Dependencies
```bash
pip install langsmith
```

JavaScript Dependencies
```bash
npm install langsmith
```

CLI Tool

```bash
curl -sSL https://raw.githubusercontent.com/langchain-ai/langsmith-cli/main/scripts/install.sh | sh
```
</setup>

<usage>
Use the `langsmith` CLI to manage datasets and examples.

### Dataset Commands

- `langsmith dataset list` - List datasets in LangSmith
- `langsmith dataset get <name-or-id>` - View dataset details
- `langsmith dataset create --name <name>` - Create a new empty dataset
- `langsmith dataset delete <name-or-id>` - Delete a dataset
- `langsmith dataset export <name-or-id> <output-file>` - Export dataset to local JSON file
- `langsmith dataset upload <file> --name <name>` - Upload a local JSON file as a dataset

### Example Commands

- `langsmith example list --dataset <name>` - List examples in a dataset
- `langsmith example create --dataset <name> --inputs <json>` - Add an example to a dataset
- `langsmith example delete <example-id>` - Delete an example

### Experiment Commands

- `langsmith experiment list --dataset <name>` - List experiments for a dataset
- `langsmith experiment get <name>` - View experiment results

### Common Flags

- `--limit N` - Limit number of results
- `--yes` - Skip confirmation prompts (use with caution)

**IMPORTANT - Safety Prompts:**
- The CLI prompts for confirmation before destructive operations (delete, overwrite)
- **If you are running with user input:** ALWAYS wait for user input; NEVER use `--yes` unless the user explicitly requests it
- **If you are running non-interactively:** Use `--yes` to skip confirmation prompts
</usage>

<dataset_types_overview>
Common evaluation dataset types:

- **final_response** - Full conversation with expected output. Tests complete agent behavior.
- **single_step** - Single node inputs/outputs. Tests specific node behavior (e.g., one LLM call or tool).
- **trajectory** - Tool call sequence. Tests execution path (ordered list of tool names).
- **rag** - Question/chunks/answer/citations. Tests retrieval quality.
</dataset_types_overview>

<creating_datasets>
## Creating Datasets

Datasets are JSON files with an array of examples. Each example has `inputs` and `outputs`.

### From Exported Traces (Programmatic)

Export traces first, then process them into dataset format using code:

```bash
# 1. Export traces to JSONL files
langsmith trace export ./traces --project my-project --limit 20 --full
```

<python>
```python
import json
from pathlib import Path
from langsmith import Client

client = Client()

# 2. Process traces into dataset examples
examples = []
for jsonl_file in Path("./traces").glob("*.jsonl"):
    runs = [json.loads(line) for line in jsonl_file.read_text().strip().split("\n")]
    root = next((r for r in runs if r.get("parent_run_id") is None), None)
    if root and root.get("inputs") and root.get("outputs"):
        examples.append({
            "trace_id": root.get("trace_id"),
            "inputs": root["inputs"],
            "outputs": root["outputs"]
        })

# 3. Save locally
with open("/tmp/dataset.json", "w") as f:
    json.dump(examples, f, indent=2)
```
</python>

<typescript>
```typescript
import { Client } from "langsmith";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const client = new Client();

// 2. Process traces into dataset examples
const examples: Array<{trace_id?: string, inputs: Record<string, any>, outputs: Record<string, any>}> = [];
const files = readdirSync("./traces").filter(f => f.endsWith(".jsonl"));

for (const file of files) {
  const lines = readFileSync(join("./traces", file), "utf-8").trim().split("\n");
  const runs = lines.map(line => JSON.parse(line));
  const root = runs.find(r => r.parent_run_id == null);
  if (root?.inputs && root?.outputs) {
    examples.push({ trace_id: root.trace_id, inputs: root.inputs, outputs: root.outputs });
  }
}

// 3. Save locally
writeFileSync("/tmp/dataset.json", JSON.stringify(examples, null, 2));
```
</typescript>

### Upload to LangSmith

```bash
# Upload local JSON file as a dataset
langsmith dataset upload /tmp/dataset.json --name "My Evaluation Dataset"
```

### Using the SDK Directly

<python>
```python
from langsmith import Client

client = Client()

# Create dataset and add examples in one step
dataset = client.create_dataset("My Dataset", description="Evaluation dataset")

client.create_examples(
    inputs=[{"query": "What is AI?"}, {"query": "Explain RAG"}],
    outputs=[{"answer": "AI is..."}, {"answer": "RAG is..."}],
    dataset_name="My Dataset",
)
```
</python>

<typescript>
```typescript
import { Client } from "langsmith";

const client = new Client();

// Create dataset and add examples
const dataset = await client.createDataset("My Dataset", {
  description: "Evaluation dataset",
});

await client.createExamples({
  inputs: [{ query: "What is AI?" }, { query: "Explain RAG" }],
  outputs: [{ answer: "AI is..." }, { answer: "RAG is..." }],
  datasetName: "My Dataset",
});
```
</typescript>
</creating_datasets>

<dataset_structures>
## Dataset Structures by Type

### Final Response
```json
{"trace_id": "...", "inputs": {"query": "What are the top genres?"}, "outputs": {"response": "The top genres are..."}}
```

### Single Step
```json
{"trace_id": "...", "inputs": {"messages": [...]}, "outputs": {"content": "..."}, "metadata": {"node_name": "model"}}
```

### Trajectory
```json
{"trace_id": "...", "inputs": {"query": "..."}, "outputs": {"expected_trajectory": ["tool_a", "tool_b", "tool_c"]}}
```

### RAG
```json
{"trace_id": "...", "inputs": {"question": "How do I..."}, "outputs": {"answer": "...", "retrieved_chunks": ["..."], "cited_chunks": ["..."]}}
```
</dataset_structures>

<script_usage>
## CLI Usage

```bash
# List all datasets
langsmith dataset list

# Get dataset details
langsmith dataset get "My Dataset"

# Create an empty dataset
langsmith dataset create --name "New Dataset" --description "For evaluation"

# Upload a local JSON file
langsmith dataset upload /tmp/dataset.json --name "My Dataset"

# Export a dataset to local file
langsmith dataset export "My Dataset" /tmp/exported.json --limit 100

# Delete a dataset
langsmith dataset delete "My Dataset"

# List examples in a dataset
langsmith example list --dataset "My Dataset" --limit 10

# Add an example
langsmith example create --dataset "My Dataset" \
  --inputs '{"query": "test"}' \
  --outputs '{"answer": "result"}'

# List experiments
langsmith experiment list --dataset "My Dataset"
langsmith experiment get "eval-v1"
```
</script_usage>

<example_workflow>
Complete workflow from traces to uploaded LangSmith dataset:

```bash
# 1. Export traces from LangSmith
langsmith trace export ./traces --project my-project --limit 20 --full

# 2. Process traces into dataset format (using Python/JS code)
# See "Creating Datasets" section above

# 3. Upload to LangSmith
langsmith dataset upload /tmp/final_response.json --name "Skills: Final Response"
langsmith dataset upload /tmp/trajectory.json --name "Skills: Trajectory"

# 4. Verify upload
langsmith dataset list
langsmith dataset get "Skills: Final Response"
langsmith example list --dataset "Skills: Final Response" --limit 3

# 5. Run experiments
langsmith experiment list --dataset "Skills: Final Response"
```
</example_workflow>

<troubleshooting>
**Dataset upload fails:**
- Verify LANGSMITH_API_KEY is set
- Check JSON file is valid: each element needs `inputs` (and optionally `outputs`)
- Dataset name must be unique, or delete existing first with `langsmith dataset delete`

**Empty dataset after upload:**
- Verify JSON file contains an array of objects with `inputs` key
- Check file isn't empty: `langsmith example list --dataset "Name"`

**Export has no data:**
- Ensure traces were exported with `--full` flag to include inputs/outputs
- Verify traces have both `inputs` and `outputs` populated

**Example count mismatch:**
- Use `langsmith dataset get "Name"` to check remote count
- Compare with local file to verify upload completeness
</troubleshooting>
</output>
