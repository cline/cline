# Basic Answer

AI-powered answers with real-time search. Searches across web, academic, and financial sources, then uses AI to generate a readable response.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.answer({
  query: "latest developments in quantum computing",
});

console.log(data.contents);
```

```python
from valyu import Valyu

valyu = Valyu()  # Uses VALYU_API_KEY from env

data = valyu.answer(
    query="latest developments in quantum computing",
)

print(data["contents"])
```

## CLI
```bash
scripts/valyu answer "What are the latest developments in quantum computing?"
```
