# Heavy Research Task

Use `heavy` mode for comprehensive, in-depth analysis (~90 minutes).

## Step 1: Create Task

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const task = await valyu.deepresearch.create({
  input: "Analyze the competitive landscape of the cloud computing market in 2024",
  model: "heavy"
});

console.log(`Task created: ${task.deepresearch_id}`);
console.log(`Status: ${task.status}`);
```

## Step 2: Wait for Completion

```typescript
const result = await valyu.deepresearch.wait(task.deepresearch_id, {
  pollInterval: 5000
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
    input="Analyze the competitive landscape of the cloud computing market in 2024",
    model="heavy"
)

# Wait for completion
result = valyu.deepresearch.wait(
    task.deepresearch_id,
    poll_interval=5
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
scripts/valyu deepresearch create "Cloud computing market analysis 2024" --model heavy --pdf
scripts/valyu deepresearch status <task-id>
```

## When to Use Heavy Mode

- Comprehensive market analysis
- Literature reviews
- Competitive intelligence
- Complex technical deep dives
- Topics requiring multi-source synthesis
