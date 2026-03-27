# Multi-Topic News Monitoring

Track multiple topics in a single monitoring workflow.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu();

interface MonitoringResult {
  count: number;
  articles: any[];
}

async function monitorTopics(
  topics: string[],
  daysBack: number = 7
): Promise<Record<string, MonitoringResult>> {
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const results: Record<string, MonitoringResult> = {};

  for (const topic of topics) {
    const response = await valyu.search({
      query: topic,
      searchType: "news",
      maxNumResults: 20,
      startDate,
      endDate,
    });

    if (response.success) {
      results[topic] = {
        count: response.results.length,
        articles: response.results
      };
      console.log(`📰 ${topic}: ${response.results.length} articles`);
    }
  }

  return results;
}

// Monitor tech and business topics
const news = await monitorTopics([
  "artificial intelligence breakthroughs",
  "cryptocurrency regulation",
  "renewable energy investments",
  "tech layoffs announcements"
]);
```

```python
from valyu import Valyu
from datetime import datetime, timedelta

valyu = Valyu()

def monitor_topics(topics: list, days_back: int = 7):
    """Monitor multiple news topics with date filtering."""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    results = {}

    for topic in topics:
        response = valyu.search(
            query=topic,
            search_type="news",
            max_num_results=20,
            start_date=start_date,
            end_date=end_date,
        )

        if response.get("success"):
            results[topic] = {
                "count": len(response["results"]),
                "articles": response["results"]
            }
            print(f"📰 {topic}: {len(response['results'])} articles")

    return results

# Monitor tech and business topics
news = monitor_topics([
    "artificial intelligence breakthroughs",
    "cryptocurrency regulation",
    "renewable energy investments",
    "tech layoffs announcements"
])
```
