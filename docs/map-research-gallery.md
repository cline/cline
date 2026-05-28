# AI-Hydro Research Gallery

## Purpose

The AI-Hydro Research Gallery is a discovery and import surface for reusable
hydrologic map artifacts. It is not a generic sample picker and it is not a
replacement for modules, skills, MCP tools, workflows, or the knowledge base.

The Gallery should answer:

> What has the AI-Hydro community already made that I can inspect, cite,
> import, and reuse in my map or research workflow?

## Distinction from existing surfaces

- Modules and courses teach concepts through guided HTML content.
- Skills are agent playbooks and reusable reasoning procedures.
- MCP tools are executable capabilities.
- Workflow manifests describe scientific processes and recommended checks.
- The knowledge base stores concepts, variables, metrics, datasets, and references.
- The Research Gallery stores reusable visual and spatial research artifacts.

## V1 artifact types

- `map_scene`: layer stack, styles, extent, basemap, citations, and provenance references.
- `style_preset`: reusable vector or raster symbology for layers such as TWI, DEM,
  stream order, CN, land cover, or precipitation.
- `case_study`: basin or region scene with notes, validation metrics, citations,
  and provenance.
- `dataset_connector`: URL, STAC, GEE, HydroShare, or lab-mirror pointer that
  loads through the normal AI-Hydro source lifecycle.
- `map_plate_template`: Research Plate Composer settings for publication,
  report, or presentation maps.

## Product rules

- Gallery entries are manifests and references, not arbitrary executable code.
- Imports must use the same source, provenance, license, citation, and readiness
  checks as normal map operations.
- Large assets are referenced or cached through managed AI-Hydro storage; they
  are not silently written beside user source files.
- Community entries must show trust level, author, license, citation, version,
  and import warnings before use.
- The Gallery is a secondary discovery surface, not a primary add-layer control.

## Trust levels

- `official`: maintained by AI-Hydro.
- `reviewed`: community contribution passed schema, citation, license, and
  import checks.
- `community`: visible but not fully reviewed.
- `local`: private user or lab registry entry.

## Canonical naming and repository

- Feature name: **Research Gallery**
- Formal name: **AI-Hydro Research Gallery**
- Community/catalog repository: `AI-Hydro/Gallery`
- Static API: `https://ai-hydro.github.io/Gallery/api/gallery.json`
- Extension config field: `researchGalleryBaseUrl`
- Environment override: `AI_HYDRO_RESEARCH_GALLERY_BASE_URL`

Avoid alternate product names such as "Research Hub", "Map Gallery", or plain
"Gallery" in user-facing UI.

## UI placement

Research Gallery should be available through:

- command palette: `AI-Hydro Map: Open Research Gallery`
- visible map ribbon button: `Research Gallery`
- layer inspector contextual actions such as `Find styles`
- Research Plate Composer template browsing
- agent-assisted workflows

It should not appear as a default button in the compact layer add row.

## Immediate implementation state

The current built-in entries are official seed fixtures used to exercise the
import path while the public `AI-Hydro/Gallery` catalog is being populated.
The map UI should load the remote catalog when available and fall back to those
seed items when offline or when GitHub Pages has not yet published `gallery.json`.

## Gallery repository structure

`AI-Hydro/Gallery` should mirror the static marketplace pattern used by
`AI-Hydro/Modules` and `AI-Hydro/Skills`:

```text
items/
  <gallery-item-id>/
    manifest.json
    README.md
    thumbnail.png
    artifact files or source references
api/
  gallery.json
.github/workflows/
  build-api.yml
```

The GitHub Action scans `items/**/manifest.json`, validates required fields,
fills stable defaults, and writes `api/gallery.json` for GitHub Pages.
