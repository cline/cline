# Tool Call Mode

Optimize search responses for AI agents vs humans.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu();

// For AI agents (default) - optimized for LLM processing
const agentResults = await valyu.search({
  query: "quantum computing breakthroughs",
  toolCallMode: true  // Default
});

// For human readability
const humanResults = await valyu.search({
  query: "quantum computing breakthroughs",
  toolCallMode: false
});
```

```python
from valyu import Valyu

valyu = Valyu()

# For AI agents (default)
agent_results = valyu.search(
    query="quantum computing breakthroughs",
    tool_call_mode=True  # Default
)

# For human readability
human_results = valyu.search(
    query="quantum computing breakthroughs",
    tool_call_mode=False
)
```

## When to Use

- **`toolCallMode: true`** (default) - When results will be processed by an LLM or agent
- **`toolCallMode: false`** - When results will be displayed directly to users
