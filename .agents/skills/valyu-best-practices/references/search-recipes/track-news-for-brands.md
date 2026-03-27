# Brand News Tracking

Track news mentions for brands and compare against competitors.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu();

async function brandMonitoring(brand: string, competitorBrands: string[] = []) {
  // Main brand news
  const brandNews = await valyu.search({
    query: `${brand} news announcements`,
    searchType: "news",
    maxNumResults: 50,
  });

  console.log(`=== ${brand} News ===`);
  console.log(`Found ${brandNews.results.length} articles`);

  brandNews.results.slice(0, 5).forEach(article => {
    console.log(`  - ${article.title}`);
  });

  // Competitor comparison
  if (competitorBrands.length > 0) {
    console.log(`\n=== Competitor Coverage ===`);
    for (const competitor of competitorBrands) {
      const compNews = await valyu.search({
        query: `${competitor} news`,
        searchType: "news",
        maxNumResults: 20,
      });
      console.log(`${competitor}: ${compNews.results.length} articles`);
    }
  }

  return brandNews;
}

// Monitor Tesla and competitors
const teslaNews = await brandMonitoring(
  "Tesla",
  ["Rivian", "Lucid Motors", "Ford EV"]
);
```

```python
from valyu import Valyu

valyu = Valyu()

def brand_monitoring(brand: str, competitor_brands: list = None):
    """Monitor news for a brand and its competitors."""

    # Main brand news
    brand_news = valyu.search(
        query=f"{brand} news announcements",
        search_type="news",
        max_num_results=50,
    )

    print(f"=== {brand} News ===")
    print(f"Found {len(brand_news['results'])} articles")

    for article in brand_news["results"][:5]:
        print(f"  - {article['title']}")

    # Competitor comparison
    if competitor_brands:
        print(f"\n=== Competitor Coverage ===")
        for competitor in competitor_brands:
            comp_news = valyu.search(
                query=f"{competitor} news",
                search_type="news",
                max_num_results=20,
            )
            print(f"{competitor}: {len(comp_news['results'])} articles")

    return brand_news

# Monitor Tesla and competitors
tesla_news = brand_monitoring(
    brand="Tesla",
    competitor_brands=["Rivian", "Lucid Motors", "Ford EV"]
)
```
