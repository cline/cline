# Answer with Custom Instructions

Guide the AI on how to process and format the answer using `systemInstructions`.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.answer({
  query: "climate change research",
  systemInstructions: "Focus on practical applications and commercial impact. Summarise key findings as bullet points."
});

console.log(data.contents);
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.answer(
    query="climate change research",
    system_instructions="Focus on practical applications and commercial impact. Summarise key findings as bullet points."
)

print(data["contents"])
```

## Example Instructions

- "Respond in bullet points"
- "Focus on technical details"
- "Summarize in 2-3 paragraphs"
- "Include specific numbers and statistics"
- "Write for a non-technical audience"
- "Compare and contrast the options"
