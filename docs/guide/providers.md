---
description: AI-Hydro Models & Providers — supported AI providers, recommended model families, local-only setup with Ollama / LM Studio, and tips for cost and reliability.
---

# Models & Providers

AI-Hydro is **provider-agnostic** — it works with every AI provider supported by the underlying agent. Pick the one that matches your budget, latency needs, and data-residency rules.

!!! tip "TL;DR"
    Use the **latest Anthropic Claude Sonnet** for day-to-day research. Switch to a frontier-tier reasoning model (Anthropic Opus, OpenAI's reasoning models, or equivalent) for long multi-step calibration runs. For sensitive data, point AI-Hydro at **Ollama** or **LM Studio** and run fully offline.

## Supported providers

| Provider | Best for | Notes |
|---|---|---|
| **Anthropic** | General research, default recommendation | Direct API or via Claude Code subscription |
| **OpenAI** | Structured extraction, large context windows | Includes GPT and o-series reasoning models |
| **Google Gemini** | Long-document literature work | 1M+ token context useful for review papers |
| **AWS Bedrock** | Enterprise / VPC deployments | Anthropic and other models inside your AWS account |
| **Azure OpenAI** | Enterprise tenants on Azure | OpenAI models with your tenant's compliance |
| **OpenRouter** | One key for everything | Routes to any supported provider, easy A/B |
| **Ollama** | Fully local, offline, sensitive data | Llama, Qwen, and other open-weights models |
| **LM Studio** | Fully local, GUI workflow | Same idea as Ollama with a desktop client |
| **xAI, Mistral, DeepSeek, Groq, Cerebras, Fireworks, Together, Vercel AI Gateway, GCP Vertex AI, SAP AI Core, Z.AI, Doubao, Baseten, Requesty, OpenAI-compatible endpoints** | Provider-specific cost / latency / region needs | All configured the same way in extension settings |

## Choosing a model

AI-Hydro doesn't lock you to a specific model version because frontier models change every few months. Two rules of thumb:

1. **For most sessions**, the *latest mid-tier* model from your provider of choice is the sweet spot — fast enough for interactive chat, cheap enough to run all day, smart enough to chain 5–10 tool calls without losing the thread.
2. **For long calibration runs, multi-basin sweeps, or unfamiliar workflows**, swap to the *frontier-tier* model from the same provider. The extra cost is small per session and the failure rate drops noticeably.

If you are comparing providers, run the same prompt through two of them in parallel using two VS Code windows pointed at the same workspace. Sessions are file-based, so both runs append into the same provenance trail.

## Local-only setup

For sensitive data (unpublished gauge networks, indigenous-territory studies, embargoed datasets), point AI-Hydro at a local model server:

1. Install [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/).
2. Pull a tool-use-capable open-weights model (e.g. recent Llama or Qwen instruct variants).
3. In the AI-Hydro VS Code extension settings, choose **Ollama** or **LM Studio** as the provider and point at `http://localhost:11434` (Ollama) or your LM Studio server URL.
4. No API key, no outbound traffic for the AI calls themselves. (Data tools still hit USGS/3DEP/GridMET unless you've pre-cached or disabled them.)

!!! warning "Local model caveat"
    Open-weights models lag frontier models for multi-step tool use. Expect to babysit longer chains, trim prompts more aggressively, and accept that some workflows (especially calibration loops) will need a frontier model to converge in a reasonable time.

## Cost notes

- AI-Hydro adds **no charges** on top of your provider's bill.
- A typical session (delineation + signatures + a short HBV calibration) uses well under 100K tokens.
- If you already pay a flat-rate plan (Claude Pro/Max, ChatGPT Plus, Gemini Advanced), the included usage covers many sessions per month.
- For per-token costs, consult each provider's pricing page directly — they change too often to mirror here.

## Configuring the provider

In VS Code, open the AI-Hydro side panel → **⚙ Settings** → **API Configuration**, choose your provider, paste the API key, and pick a model. The setting is per-workspace by default, so different projects can use different providers without affecting each other.

For headless / CLI use, the same configuration lives in `~/.aihydro/config.json`. See the [VS Code Extension](vscode-extension.md) page for full details, including how to register additional standalone MCP servers alongside `aihydro-mcp`.
