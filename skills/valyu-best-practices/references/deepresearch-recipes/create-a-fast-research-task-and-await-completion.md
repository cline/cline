# Fast Research Task

Use `fast` mode for quick answers, lightweight research, and simple lookups (~5 minutes).

## Step 1: Create Task

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const task = await valyu.deepresearch.create({
  input: "What are the key differences between RAG and fine-tuning for LLMs?",
  model: "fast"
});

console.log(`Task created: ${task.deepresearch_id}`);
console.log(`Status: ${task.status}`);
```

## Step 2: Wait for Completion

```typescript
const result = await valyu.deepresearch.wait(task.deepresearch_id, {
  pollInterval: 5000,    // Check every 5 seconds
  maxWaitTime: 600000    // Timeout after 10 minutes
});

if (result.status === "completed") {
  console.log("Research completed!");
  console.log(result.output);

  result.sources?.forEach(source => {
    console.log(`- ${source.title}: ${source.url}`);
  });

  console.log(`Total cost: $${result.usage?.total_cost.toFixed(4)}`);
}
```

```python
from valyu import Valyu

valyu = Valyu()

# Create task
task = valyu.deepresearch.create(
    input="What are the key differences between RAG and fine-tuning for LLMs?",
    model="fast"
)

# Wait for completion
result = valyu.deepresearch.wait(
    task.deepresearch_id,
    poll_interval=5,
    max_wait_time=600
)

if result.status == "completed":
    print("Research completed!")
    print(result.output)
    print(f"Total cost: ${result.usage.total_cost:.4f}")
```

## CLI
```bash
scripts/valyu deepresearch create "What are the key differences between RAG and fine-tuning?" --model fast
scripts/valyu deepresearch status <task-id>
```
