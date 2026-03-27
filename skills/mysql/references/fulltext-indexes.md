---
title: Fulltext Search Indexes
description: Fulltext index guide
tags: mysql, fulltext, search, indexes, boolean-mode
---

# Fulltext Indexes

Fulltext indexes are useful for keyword text search in MySQL. For advanced ranking, fuzzy matching, or complex document search, prefer a dedicated search engine.

```sql
ALTER TABLE articles ADD FULLTEXT INDEX ft_title_body (title, body);

-- Natural language (default, sorted by relevance)
SELECT *, MATCH(title, body) AGAINST('database performance') AS score
FROM articles WHERE MATCH(title, body) AGAINST('database performance');

-- Boolean mode: + required, - excluded, * suffix wildcard, "exact phrase"
WHERE MATCH(title, body) AGAINST('+mysql -postgres +optim*' IN BOOLEAN MODE);
```

## Key Gotchas
- **Min word length**: default 3 chars (`innodb_ft_min_token_size`). Shorter words are ignored. Changing this requires rebuilding the FULLTEXT index (drop/recreate) to take effect.
- **Stopwords**: common words excluded. Control stopwords with `innodb_ft_enable_stopword` and customize via `innodb_ft_user_stopword_table` / `innodb_ft_server_stopword_table` (set before creating the index, then rebuild to apply changes).
- **No partial matching**: unlike `LIKE '%term%'`, requires whole tokens (except `*` in boolean mode).
- **MATCH() columns must correspond to an index definition**: `MATCH(title, body)` needs a FULLTEXT index that covers the same column set (e.g. `(title, body)`).
- Boolean mode without required terms (no leading `+`) can match a very large portion of the index and be slow.
- Fulltext adds write overhead — consider Elasticsearch/Meilisearch for complex search needs.
