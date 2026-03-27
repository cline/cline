# Prediction Markets Search

Real-time probability data from Polymarket and Kalshi. Search prediction market odds for events.

## Why Prediction Markets Matter

Prediction markets aggregate information differently than polls or analyst forecasts. Participants stake money on outcomes, creating a financial filter where uninformed opinions are expensive to hold and private information gets priced in quickly.

## Market Coverage

| Category | Examples |
|----------|----------|
| Economics | Fed rate decisions, CPI prints, unemployment |
| Finance | Earnings predictions, M&A outcomes |
| Geopolitics | Ceasefire probabilities, leadership changes |
| Technology | Product launches, acquisitions |
| Sports | NFL, NBA, MLB outcomes |

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu("your-key");

// Natural language query - auto-routes to prediction markets
const response = await valyu.search({
  query: "What are the odds of a Fed rate cut in January 2025?",
  searchType: "all"
});

// Target specific market
const polymarket = await valyu.search({
  query: "Get earnings odds from Polymarket",
  includedSources: ["valyu/valyu-polymarket"],
  maxNumResults: 1
});

const kalshi = await valyu.search({
  query: "Bitcoin price prediction",
  includedSources: ["valyu/valyu-kalshi"],
  maxNumResults: 1
});
```

```python
from valyu import Valyu

valyu = Valyu(api_key="your-key")

# Natural language query
response = valyu.search(
    query="What are the odds of a Fed rate cut in January 2025?",
    search_type="all"
)

# Target Polymarket
polymarket = valyu.search(
    query="Get earnings odds from Polymarket",
    included_sources=["valyu/valyu-polymarket"],
    max_num_results=1
)
```

## Response Format

```json
{
  "event_title": "Fed Interest Rate Decision - January 2025",
  "category": "Economics",
  "total_volume": 2847293.50,
  "markets": [
    {
      "title": "Will the Fed cut rates by 25bp?",
      "outcomes": [
        { "outcome": "Yes", "probability_pct": 68.5 },
        { "outcome": "No", "probability_pct": 31.5 }
      ],
      "volume_24h": 124500.00,
      "status": "active"
    }
  ]
}
```
