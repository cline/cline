---
description: AI-Hydro Connectors — authenticated links to external data sources and compute services (Google Earth Engine, USGS NWIS, HydroShare, Planetary Computer, and more).
---

# Connectors

Connectors are **authenticated links** from AI-Hydro to external data sources and compute services. Once a connector is set up, the agent can query that service directly from MCP tools — no copy-pasting credentials, no manual API calls.

The Connectors panel shows every available connector, its authentication status, and a guided setup flow powered by the AI agent.

---

## Opening the Connectors Panel

Click the **Connectors icon** (plug icon) in the AI-Hydro sidebar, or run `AI-Hydro: Open Connectors` from the command palette.

---

## Available Connectors

| Connector | Auth type | Status | Use cases |
|---|---|---|---|
| **Google Earth Engine** | OAuth | ✅ Live | Satellite imagery, raster time series, image collections, cloud-scale geospatial analysis |
| **HAWQS** | API key | Coming soon | SWAT-based water quality simulation for any 12-digit HUC in the US |
| **USGS / NWIS** | None | Coming soon | Real-time and historical streamflow, groundwater, and water-quality observations |
| **HydroShare** | OAuth | Coming soon | Pull community datasets; publish AI-Hydro outputs as citable artifacts |
| **Microsoft Planetary Computer** | API key | Coming soon | STAC-indexed petabytes: Landsat, Sentinel, NAIP, DEMs, ERA5 via Dask |
| **OpenTopography** | API key | Coming soon | High-resolution DEMs (SRTM, ALOS, COP-30), regional lidar, on-demand processing |
| **NASA Earthdata** | OAuth | Coming soon | MODIS, GPM, SMAP, ICESat-2, and the full DAAC archive |

---

## Google Earth Engine

Google Earth Engine (GEE) is the only fully live connector. It gives the agent access to the entire GEE public data catalog for cloud-scale raster analysis — without downloading a single file to your machine.

### Setup

Click **Set up with AI →** on the GEE connector card. The agent walks you through:

1. Installing the GEE Python package (`earthengine-api`)
2. Running `earthengine authenticate` to open the OAuth browser flow
3. Selecting your GEE Cloud Project (required since 2023)
4. Running `gee.status` to verify the connection

Or follow the steps manually:

```bash
pip install earthengine-api
earthengine authenticate          # opens browser → paste auth code
earthengine set_project my-project-id
```

Then verify in chat:

```
"Check if my Google Earth Engine connection is working"
```

The agent calls `gee.status` — if it returns `{"authenticated": true}`, you are ready.

### GEE MCP Tools

Once connected, three MCP tools become available:

#### `gee.status`

Check authentication status and quota.

```python
gee.status()
# → {"authenticated": true, "project": "my-gee-project", "quota": {...}}
```

#### `gee.preview_layer`

Render a GEE image or image collection as a slippy-map tile layer and push it to the AI-Hydro map panel.

```python
gee.preview_layer(
    asset_id="USGS/SRTMGL1_003",   # any GEE asset ID
    band="elevation",
    vis_params={"min": 0, "max": 3000, "palette": ["006633","E5FFCC","662A00","D8D8D8","F5F5F5"]},
    name="SRTM Elevation",
    zoom_to=True,
)
```

The layer appears in the map panel with the given colour ramp. Supports `Image`, `ImageCollection` (first image or mosaic), and `FeatureCollection`.

#### `gee.extract_timeseries`

Extract a time series of band values over a region of interest (ROI).

```python
gee.extract_timeseries(
    collection="MODIS/006/MOD16A2",   # ImageCollection asset ID
    band="ET",
    roi=watershed_geojson,             # GeoJSON polygon or bbox
    start="2015-01-01",
    end="2020-12-31",
    reducer="mean",                    # mean | sum | max | min | median
    scale=500,                         # spatial resolution in metres
)
# → {"dates": [...], "values": [...], "unit": "kg/m²/8day"}
```

Use this to extract NDVI, ET, precipitation, or any other MODIS/Landsat/Sentinel band over your study watershed.

### Common GEE Workflows

**NDVI time series over a delineated watershed:**
```
"Extract NDVI from Landsat 8 for the Piscataquis River watershed between 2017 and 2022, 
 plot the seasonal cycle, and show the mean composite on the map."
```

**MODIS ET comparison between two catchments:**
```
"Compare MODIS ET (MOD16A2) over gauges 01031500 and 01047000 for water year 2019."
```

**Elevation profile from SRTM:**
```
"Show me the SRTM elevation of my watershed and overlay the TWI grid I computed earlier."
```

---

## Authentication Architecture

Credentials are stored in VS Code's **secret storage** — they are encrypted on disk and never written to `aihydro_mcp_settings.json` or any plain-text file.

```
Secret key format: aihydro.connectors.<connectorId>.<secretName>
Example:           aihydro.connectors.planetary_computer.api_key
```

The MCP server reads credentials from the extension's secret store via the standard `AIHYDRO_CONNECTOR_*` environment variables it injects into the server process at startup.

---

## Connector Status Indicators

Each connector card in the panel shows a status badge:

| Badge | Meaning |
|---|---|
| 🟢 Connected | Auth valid, last ping successful |
| 🔴 Error | Auth present but last call failed (token expired, quota exceeded, etc.) |
| ⚪ Disconnected | Not set up |
| 🔵 Coming soon | Connector in development; click to register interest |

---

## Coming-Soon Connectors

Connectors marked "coming soon" have their architecture designed but are not yet implemented. Click the card to register interest — high-interest connectors are prioritised for the next release.

If you need a connector now, you can use Python execution directly:

```python
# USGS NWIS via dataretrieval (no connector needed today)
import dataretrieval.nwis as nwis
df = nwis.get_record(sites='01031500', service='dv',
                     start='2020-01-01', end='2020-12-31')
```

The agent knows to suggest this pattern when a connector is not yet available.

---

## Roadmap

- **HAWQS** — SWAT simulation with agent-guided HUC12 setup
- **HydroShare** — bidirectional: pull community datasets, publish AI-Hydro sessions as citable resources
- **Planetary Computer** — STAC search + Dask-backed analysis over Landsat/Sentinel archives
- **OpenTopography** — on-demand DEM extraction for any global extent with lidar availability check
- **NASA Earthdata** — unified DAAC search covering MODIS, GPM, SMAP, ICESat-2 product families
