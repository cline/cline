# Search All Data Sources

Search across web content, academic journals, financial data, and proprietary datasets. By setting the `searchType` to `all`, it searches over everything all at once.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const response = await valyu.search({
  query: "latest developments in quantum computing",
  searchType: "all",
});

response.results.forEach(result => {
  console.log(`Title: ${result.title}`);
  console.log(`URL: ${result.url}`);
  console.log(`Source: ${result.sourceType}`);
  console.log(`Content: ${result.content.substring(0, 200)}...`);
});
```

```python
from valyu import Valyu

valyu = Valyu(YOUR_VALYU_API_KEY_HERE)

response = valyu.search(
    query="latest developments in quantum computing",
    max_num_results=5,
    search_type="all",
)

for result in response["results"]:
    print(f"Title: {result['title']}")
    print(f"URL: {result['url']}")
    print(f"Source: {result['source_type']}")
    print(f"Content: {result['content'][:200]}...")
```

## CLI
```bash
scripts/valyu search web "latest developments in quantum computing" 10
```
