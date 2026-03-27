# News Search

Search real-time news articles with date and country filtering. News mode is optimized for finding current events, breaking news, and journalism content.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

// Basic news search
const response = await valyu.search({
  query: "artificial intelligence regulation",
  searchType: "news",
  maxNumResults: 20,
});

// With date filtering
const filtered = await valyu.search({
  query: "climate policy announcements",
  searchType: "news",
  maxNumResults: 30,
  startDate: "2025-01-01",
  endDate: "2025-12-31",
});

// With country filtering
const usNews = await valyu.search({
  query: "technology funding news",
  searchType: "news",
  maxNumResults: 50,
  countryCode: "US",
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Basic news search
response = valyu.search(
    query="artificial intelligence regulation",
    search_type="news",
    max_num_results=20,
)

# With date filtering
filtered = valyu.search(
    query="climate policy announcements",
    search_type="news",
    max_num_results=30,
    start_date="2025-01-01",
    end_date="2025-12-31",
)

# With country filtering
us_news = valyu.search(
    query="technology funding news",
    search_type="news",
    max_num_results=50,
    country_code="US",
)
```

## CLI
```bash
scripts/valyu search news "artificial intelligence regulation" 20
```
