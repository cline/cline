# Monitor for Breaking News

Track breaking news on specific topics in real-time.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu();

async function monitorBreakingNews(topics: string[], hoursBack = 24) {
  const today = new Date().toISOString().split("T")[0];

  for (const topic of topics) {
    const response = await valyu.search({
      query: `${topic} breaking news today`,
      searchType: "news",
      maxNumResults: 10,
      startDate: today,
    });

    console.log(`\n🔴 ${topic}:`);
    response.results.slice(0, 3).forEach(article => {
      console.log(`  - ${article.title}`);
      console.log(`    ${article.url}`);
    });
  }
}

// Usage
await monitorBreakingNews([
  "stock market",
  "federal reserve",
  "technology",
  "politics"
]);
```

```python
from valyu import Valyu
from datetime import datetime

valyu = Valyu()

def monitor_breaking_news(topics: list, hours_back: int = 24):
    """Get recent breaking news on topics."""
    today = datetime.now().strftime("%Y-%m-%d")

    for topic in topics:
        response = valyu.search(
            query=f"{topic} breaking news today",
            search_type="news",
            max_num_results=10,
            start_date=today,
        )

        print(f"\n🔴 {topic}:")
        for article in response["results"][:3]:
            print(f"  - {article['title']}")
            print(f"    {article['url']}")

# Usage
monitor_breaking_news([
    "stock market",
    "federal reserve",
    "technology",
    "politics"
])
```
