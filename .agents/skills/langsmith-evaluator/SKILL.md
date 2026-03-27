---
name: langsmith-evaluator
description: "INVOKE THIS SKILL when building evaluation pipelines for LangSmith. Covers three core components: (1) Creating Evaluators - LLM-as-Judge, custom code; (2) Defining Run Functions - how to capture outputs and trajectories from your agent; (3) Running Evaluations - locally with evaluate() or auto-run via LangSmith. Uses the langsmith CLI tool."
---

<oneliner>
Three core components: **(1) Creating Evaluators** - LLM-as-Judge, custom code; **(2) Defining Run Functions** - capture agent outputs/trajectories for evaluation; **(3) Running Evaluations** - locally with `evaluate()` or auto-run via uploaded evaluators. Python and TypeScript examples included.
</oneliner>

<setup>
Environment Variables

```bash
LANGSMITH_API_KEY=lsv2_pt_your_api_key_here          # Required
LANGSMITH_PROJECT=your-project-name                   # Check this to know which project has traces
LANGSMITH_WORKSPACE_ID=your-workspace-id              # Optional: for org-scoped keys
OPENAI_API_KEY=your_openai_key                        # For LLM as Judge
```

**IMPORTANT:** Always check the environment variables or `.env` file for `LANGSMITH_PROJECT` before querying or interacting with LangSmith. This tells you which project contains the relevant traces and data. If the LangSmith project is not available, use your best judgement to identify the right one.

Python Dependencies
```bash
pip install langsmith langchain-openai python-dotenv
```

CLI Tool (for uploading evaluators)
```bash
curl -sSL https://raw.githubusercontent.com/langchain-ai/langsmith-cli/main/scripts/install.sh | sh
```

JavaScript Dependencies
```bash
npm install langsmith openai
```
</setup>

<crucial_requirement>
## Golden Rule: Inspect Before You Implement

**CRITICAL:** Before writing ANY evaluator or extraction logic, you MUST:
1. **Run your agent** on sample inputs and capture the actual output
2. **Inspect the output** - print it, query LangSmith traces, understand the exact structure
3. **Only then** write code that processes that output

Output structures vary significantly by framework, agent type, and configuration. Never assume the shape - always verify first. Query LangSmith traces to when outputs don't contain needed data to understand how to extract from execution.
</crucial_requirement>

<evaluator_format>
## Offline vs Online Evaluators

**Offline Evaluators** (attached to datasets):
- Function signature: `(run, example)` - receives both run outputs and dataset example
- Use case: Comparing agent outputs to expected values in a dataset
- Upload with: `--dataset "Dataset Name"`

**Online Evaluators** (attached to projects):
- Function signature: `(run)` - receives only run outputs, NO example parameter
- Use case: Real-time quality checks on production runs (no reference data)
- Upload with: `--project "Project Name"`

**CRITICAL - Return Format:**
- Each evaluator returns **ONE metric only**. For multiple metrics, create multiple evaluator functions.
- Do NOT return `{"metric_name": value}` or lists of metrics - this will error.

**CRITICAL - Local vs Uploaded Differences:**

| | Local `evaluate()` | Uploaded to LangSmith |
|---|---|---|
| **Column name** | Python: auto-derived from function name. TypeScript: must include `key` field or column is untitled | Comes from evaluator name set at upload time. Do NOT include `key` — it creates a duplicate column |
| **Python `run` type** | `RunTree` object → `run.outputs` (attribute) | `dict` → `run["outputs"]` (subscript). Handle both: `run.outputs if hasattr(run, "outputs") else run.get("outputs", {})` |
| **TypeScript `run` type** | Always attribute access: `run.outputs?.field` | Always attribute access: `run.outputs?.field` |
| **Python return** | `{"score": value, "comment": "..."}` | `{"score": value, "comment": "..."}` |
| **TypeScript return** | `{ key: "name", score: value, comment: "..." }` | `{ score: value, comment: "..." }` |
</evaluator_format>

<evaluator_types>
- **LLM as Judge** - Uses an LLM to grade outputs. Best for subjective quality (accuracy, helpfulness, relevance).
- **Custom Code** - Deterministic logic. Best for objective checks (exact match, trajectory validation, format compliance).
</evaluator_types>

<llm_judge>
## LLM as Judge Evaluators

**NOTE:** LLM-as-Judge upload is currently not supported by the CLI — only code evaluators are supported. For evaluations against a dataset, STRONGLY PREFER defining local evaluators to use with `evaluate(evaluators=[...])`.

<python>
```python
from typing import TypedDict, Annotated
from langchain_openai import ChatOpenAI

class Grade(TypedDict):
    reasoning: Annotated[str, ..., "Explain your reasoning"]
    is_accurate: Annotated[bool, ..., "True if response is accurate"]

judge = ChatOpenAI(model="gpt-4o-mini", temperature=0).with_structured_output(Grade, method="json_schema", strict=True)

async def accuracy_evaluator(run, example):
    run_outputs = run.outputs if hasattr(run, "outputs") else run.get("outputs", {}) or {}
    example_outputs = example.outputs if hasattr(example, "outputs") else example.get("outputs", {}) or {}
    grade = await judge.ainvoke([{"role": "user", "content": f"Expected: {example_outputs}\nActual: {run_outputs}\nIs this accurate?"}])
    return {"score": 1 if grade["is_accurate"] else 0, "comment": grade["reasoning"]}
```
</python>

<typescript>
```javascript
import OpenAI from "openai";

const openai = new OpenAI();

async function accuracyEvaluator(run, example) {
    const runOutputs = run.outputs ?? {};
    const exampleOutputs = example.outputs ?? {};

    const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
        { role: "system", content: 'Respond with JSON: {"is_accurate": boolean, "reasoning": string}' },
        { role: "user", content: `Expected: ${JSON.stringify(exampleOutputs)}\nActual: ${JSON.stringify(runOutputs)}\nIs this accurate?` }
    ]
    });

    const grade = JSON.parse(response.choices[0].message.content);
    return { score: grade.is_accurate ? 1 : 0, comment: grade.reasoning };
}
```
</typescript>
</llm_judge>

<code_evaluators>
## Custom Code Evaluators

**Before writing an evaluator:**
1. Inspect your dataset to understand expected field names (see Golden Rule above)
2. Test your run function and verify its output structure matches the dataset schema
3. Query LangSmith traces to debug any mismatches

<python>
```python
def trajectory_evaluator(run, example):
    run_outputs = run.outputs if hasattr(run, "outputs") else run.get("outputs", {}) or {}
    example_outputs = example.outputs if hasattr(example, "outputs") else example.get("outputs", {}) or {}
    # IMPORTANT: Replace these placeholders with your actual field names
    # 1. Query your LangSmith trace to see what fields exist in run outputs
    # 2. Check your dataset schema for expected field names
    # Note: Trajectory data may not appear in default output - verify against trace!
    actual = run_outputs.get("YOUR_TRAJECTORY_FIELD", [])
    expected = example_outputs.get("YOUR_EXPECTED_FIELD", [])
    return {"score": 1 if actual == expected else 0, "comment": f"Expected {expected}, got {actual}"}
```
</python>

<typescript>
```javascript
function trajectoryEvaluator(run, example) {
    const runOutputs = run.outputs ?? {};
    const exampleOutputs = example.outputs ?? {};
    // IMPORTANT: Replace these placeholders with your actual field names
    // 1. Query your LangSmith trace to see what fields exist in run outputs
    // 2. Check your dataset schema for expected field names
    const actual = runOutputs.YOUR_TRAJECTORY_FIELD ?? [];
    const expected = exampleOutputs.YOUR_EXPECTED_FIELD ?? [];
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    return { score: match ? 1 : 0, comment: `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
}
```
</typescript>
</code_evaluators>

<run_functions>
## Defining Run Functions

Run functions execute your agent and return outputs for evaluation.

**CRITICAL - Test Your Run Function First:**
Before writing evaluators, you MUST test your run function and inspect the actual output structure. Output shapes vary by framework, agent type, and configuration.

**Debugging workflow:**
1. Run your agent once on sample input
2. Query the trace to see the execution structure
3. Print the raw output and verify against trace to output contains the right data
4. Adjust the run function as needed
4. Verify your output matches your dataset schema

**Try your hardest to match your run function output to your dataset schema.** This makes evaluators simple and reusable. If matching isn't possible, your evaluator must know how to extract and compare the right fields from each side.

<python>
```python
def run_agent(inputs: dict) -> dict:
    result = your_agent.run(inputs)
    # ALWAYS inspect output shape first - run this, check the print, query traces
    print(f"DEBUG - type: {type(result)}, keys: {result.keys() if hasattr(result, 'keys') else 'N/A'}")
    print(f"DEBUG - value: {result}")
    return {"output": result}  # Adjust to match your dataset schema
```
</python>

<typescript>
```javascript
async function runAgent(inputs) {
    const result = await yourAgent.invoke(inputs);
    // ALWAYS inspect output shape first
    console.log("DEBUG - type:", typeof result, "keys:", Object.keys(result));
    console.log("DEBUG - value:", result);
    return { output: result };  // Adjust to match your dataset schema
}
```
</typescript>

### Capturing Trajectories

For trajectory evaluation, your run function must capture tool calls during execution.

**CRITICAL:** Run output formats vary significantly by framework and agent type. You MUST inspect before implementing:

**LangGraph agents (LangChain OSS):** Use `stream_mode="debug"` with `subgraphs=True` to capture nested subagent tool calls.

```python
import uuid

def run_agent_with_trajectory(agent, inputs: dict) -> dict:
    config = {"configurable": {"thread_id": f"eval-{uuid.uuid4()}"}}
    trajectory = []
    final_result = None

    for chunk in agent.stream(inputs, config=config, stream_mode="debug", subgraphs=True):
        # STEP 1: Print chunks to understand the structure
        print(f"DEBUG chunk: {chunk}")

        # STEP 2: Write extraction based on YOUR observed structure
        # ... your extraction logic here ...

    # IMPORTANT: After running, query the LangSmith trace to verify
    # your trajectory data is complete. Default output may be missing
    # tool calls that appear in the trace.
    return {"output": final_result, "trajectory": trajectory}
```

**Custom / Non-LangChain Agents:**

1. **Inspect output first** - Run your agent and inspect the result structure. Trajectory data may already be included in the output (e.g., `result.tool_calls`, `result.steps`, etc.)
2. **Callbacks/Hooks** - If your framework supports execution callbacks, register a hook that records tool names on each invocation
3. **Parse execution logs** - As a last resort, extract tool names from structured logs or trace data

The key is to capture the tool name at execution time, not at definition time.
</run_functions>

<upload>
## Uploading Evaluators to LangSmith

**IMPORTANT - Auto-Run Behavior:**
Evaluators uploaded to a dataset **automatically run** when you run experiments on that dataset. You do NOT need to pass them to `evaluate()` - just run your agent against the dataset and the uploaded evaluators execute automatically.

**IMPORTANT - Local vs Uploaded:**
Uploaded evaluators run in a sandboxed environment with very limited package access. Only use built-in/standard library imports, and place all imports **inside** the evaluator function body. For dataset (offline) evaluators, prefer running locally with `evaluate(evaluators=[...])` first — this gives you full package access.

**IMPORTANT - Code vs Structured Evaluators:**
- **Code evaluators** (what the CLI uploads): Run in a limited environment without external packages. Use for deterministic logic (exact match, trajectory validation).
- **Structured evaluators** (LLM-as-Judge): Configured via LangSmith UI, use a specific payload format with model/prompt/schema. The CLI does not support this format yet.

**IMPORTANT - Choose the right target:**
- `--dataset`: Offline evaluator with `(run, example)` signature - for comparing to expected values
- `--project`: Online evaluator with `(run)` signature - for real-time quality checks

You must specify one. Global evaluators are not supported.

```bash
# List all evaluators
langsmith evaluator list

# Upload offline evaluator (attached to dataset)
langsmith evaluator upload my_evaluators.py \
  --name "Trajectory Match" --function trajectory_evaluator \
  --dataset "My Dataset" --replace

# Upload online evaluator (attached to project)
langsmith evaluator upload my_evaluators.py \
  --name "Quality Check" --function quality_check \
  --project "Production Agent" --replace

# Delete
langsmith evaluator delete "Trajectory Match"
```

**IMPORTANT - Safety Prompts:**
- The CLI prompts for confirmation before destructive operations
- **NEVER use `--yes` flag unless the user explicitly requests it**
</upload>

<best_practices>
1. **Use structured output for LLM judges** - More reliable than parsing free-text
2. **Match evaluator to dataset type**
   - Final Response → LLM as Judge for quality
   - Trajectory → Custom Code for sequence
3. **Use async for LLM judges** - Enables parallel evaluation
4. **Test evaluators independently** - Validate on known good/bad examples first
5. **Choose the right language**
   - Python: Use for Python agents, langchain integrations
   - JavaScript: Use for TypeScript/Node.js agents
</best_practices>

<running_evaluations>
## Running Evaluations

**Uploaded evaluators** auto-run when you run experiments - no code needed. **Local evaluators** are passed directly for development/testing.

<python>
```python
from langsmith import evaluate

# Uploaded evaluators run automatically
results = evaluate(run_agent, data="My Dataset", experiment_prefix="eval-v1")

# Or pass local evaluators for testing
results = evaluate(run_agent, data="My Dataset", evaluators=[my_evaluator], experiment_prefix="eval-v1")
```
</python>

<typescript>
```javascript
import { evaluate } from "langsmith/evaluation";

// Uploaded evaluators run automatically
const results = await evaluate(runAgent, {
  data: "My Dataset",
  experimentPrefix: "eval-v1",
});

// Or pass local evaluators for testing
const results = await evaluate(runAgent, {
  data: "My Dataset",
  evaluators: [myEvaluator],
  experimentPrefix: "eval-v1",
});
```
</typescript>
</running_evaluations>

<troubleshooting>
## Common Issues

**Output doesn't match what you expect:** Query the LangSmith trace. It shows exact inputs/outputs at each step - compare what you find to what you're trying to extract.

**One metric per evaluator:** Return `{"score": value, "comment": "..."}`. For multiple metrics, create separate functions.

**Field name mismatch:** Your run function output must match dataset schema exactly. Inspect dataset first with `client.read_example(example_id)`.

**RunTree vs dict (Python only):** Local `evaluate()` passes `RunTree`, uploaded evaluators receive `dict`. Handle both:
```python
run_outputs = run.outputs if hasattr(run, "outputs") else run.get("outputs", {}) or {}
```
TypeScript always uses attribute access: `run.outputs?.field`
</troubleshooting>

<resources>
- [LangSmith Evaluation Concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [Custom Code Evaluators](https://changelog.langchain.com/announcements/custom-code-evaluators-in-langsmith)
- [OpenEvals - Readymade Evaluators](https://github.com/langchain-ai/openevals)
</resources>
