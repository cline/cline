---
description: The aihydro-data fetch layer in AI-Hydro — one unified interface for retrieving precipitation, temperature, ET, soil moisture, DEM, land cover, soil, and optical imagery from many backends, with automatic fallback, disk caching, and provenance manifests.
---

# Data Fetch (aihydro-data)

`aihydro-data` is the data-retrieval engine underneath AI-Hydro. Instead of remembering which API serves precipitation in India versus the US, you ask for a **variable** over a **geometry** and a **time window**, and the layer picks the right product, fetches it, caches it, and records exactly where it came from.

```text
"Fetch daily precipitation for this watershed for 2022."
```

The agent calls `data_fetch(variable="precipitation", …)` and the layer routes to the best available product for that region — GridMET in CONUS, a global product elsewhere — falling back automatically if the first source is unavailable.

---

## The mental model

Three things define any request:

| Input | Example | Notes |
|-------|---------|-------|
| **variable** | `precipitation`, `temperature`, `pet`, `soil_moisture`, `dem`, `lulc`, `soil`, `optical` | The physical quantity you want. |
| **geometry** | a watershed polygon, a bbox, or a point | Usually the current study watershed. |
| **time window** | `start` / `end` ISO-8601 | Omit for static layers like DEM or soil. |

The layer maps `(variable, region)` to a concrete **product**, fetches it from the appropriate **backend** (Google Earth Engine, STAC / Planetary Computer, OPeNDAP, `pygeohydro`, …), and returns a provenance-tracked result.

---

## Routing & automatic fallback

Each variable has a **fallback chain** of products ordered best-first. The layer tries each in turn until one succeeds:

- **Region-aware** — a CONUS request for precipitation prefers GridMET; an Indian basin falls through to a global product. The S-Asia → global fall-through is wired so no region is left without a policy.
- **Backend-aware** — for optical imagery the fast synchronous **GEE** products lead; if a basin is too large for a single GEE download, the chain falls through to **STAC** (Planetary Computer) streaming, which has no such cap.
- **Auth-aware** — products that need credentials are skipped gracefully when those credentials are absent, so an anonymous install still gets data wherever a no-auth product exists.

You never have to know the chain — but you can inspect it with `data_list_products(variable=...)`.

---

## The MCP tools

| Tool | What it does |
|------|--------------|
| `data_fetch` | Fetch a single variable for one geometry / time window. The workhorse. |
| `data_batch_fetch` | Parallel fetch over **N** geometries — a set of watersheds or gauges at once. |
| `data_list_products` | Discover available products, optionally filtered by variable/region. |
| `data_describe_product` | Full `ProductSpec` for one product — citation, resolution, extent, bands, auth. |
| `data_validate_request` | Pre-flight dry-run — validate a request **without hitting any backend**. |
| `data_get_cache_status` | Summary of the disk cache at `~/.aihydro/cache/data/`. |
| `data_invalidate_cache` | Remove a specific cached entry to force a refresh. |
| `data_doctor` | Environment health check — probes each backend, auth state, cache size. |
| `data_help` | Guided onboarding and topic reference for the fetch layer. |

`data_fetch` and `data_help` are the two you'll reach for most; the rest are introspection and maintenance. Use `describe_tool(name)` to pull the full schema for any of them before first use.

---

## Caching & provenance

Every successful fetch is:

- **Cached to disk** at `~/.aihydro/cache/data/` keyed on `(product, geometry, time window, parameters)`, so the same request is instant the second time. Inspect with `data_get_cache_status`, clear a stale entry with `data_invalidate_cache`.
- **Recorded in a provenance manifest** — the product id, backend, source URL/citation, retrieval timestamp, and the exact request parameters travel with the result. This is what makes downstream analyses reproducible and citable.

---

## Validate before you fetch

For expensive or large requests, ask the layer to check the request first:

```python
data_validate_request(variable="optical", ...)   # dry-run, no network
```

It confirms the variable is known, a product exists for the region, the geometry and dates are well-formed, and reports the product that *would* be used — all without touching a backend. `data_doctor` complements this by telling you which backends are actually reachable and authenticated on your machine.

---

## Optical imagery & spectral indices

`variable="optical"` returns a multi-band surface-reflectance dataset (blue, green, red, NIR, SWIR1, SWIR2). You rarely call it directly — the [Spectral Indices](spectral-indices.md) tool sits on top of it, fetching exactly the bands an index needs, masking clouds, and compositing. The same routing applies: GEE leads, STAC streams the large basins.

---

## Related

- [Spectral Indices](spectral-indices.md) — the index layer built on `optical` fetches
- [Complete Tool Reference](../tools/reference.md) — full schemas for every `data_*` tool
- [Sessions & Provenance](sessions.md) — how fetched data is tracked across a study
