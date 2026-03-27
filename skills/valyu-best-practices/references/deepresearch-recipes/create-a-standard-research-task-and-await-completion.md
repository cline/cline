# Standard Research Task

Use `standard` mode for balanced research (~10-20 minutes). Good for most use cases.

## Step 1: Create Task

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const task = await valyu.deepresearch.create({
  input: "Comprehensive analysis of electric vehicle battery technology trends 2024",
  model: "standard"
});

console.log(`Task created: ${task.deepresearch_id}`);
console.log(`Status: ${task.status}`);
```

## Step 2: Wait for Completion

```typescript
const result = await valyu.deepresearch.wait(task.deepresearch_id, {
  pollInterval: 5000,
  maxWaitTime: 1800000  // 30 minutes
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
    input="Comprehensive analysis of electric vehicle battery technology trends 2024",
    model="standard"
)

# Wait for completion
result = valyu.deepresearch.wait(
    task.deepresearch_id,
    poll_interval=5,
    max_wait_time=1800
)

if result.status == "completed":
    print("Research completed!")
    print(result.output)
    for source in result.sources:
        print(f"- {source.title}: {source.url}")
    print(f"Total cost: ${result.usage.total_cost:.4f}")
```

## CLI
```bash
scripts/valyu deepresearch create "EV battery technology trends 2024" --model standard
scripts/valyu deepresearch status <task-id>
```
