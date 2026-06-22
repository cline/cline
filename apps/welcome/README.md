# Welcome App

Next.js onboarding app for the Cline workspace.

## Requirements

- Bun `1.3.13`
- Node.js `22` or newer

## Install

Install dependencies from the repository root so Bun uses the shared workspace lockfile:

```bash
bun install
```

## Development

Run the app from the repository root:

```bash
bun -F @cline/welcome dev
```

Or from this directory:

```bash
bun run dev
```

The development server starts with Next.js and prints the local URL.

## Build

```bash
bun -F @cline/welcome build
```

## Troubleshooting

If `bun run dev` stays on `Compiling / ...`, stop the dev server and check for a Turbopack panic mentioning `No space left on device`. Clear this app's generated cache and retry:

```bash
rm -rf apps/welcome/.next
bun -F @cline/welcome dev
```

If it still hangs, check available disk space with `df -h`.

## Scripts

- `bun run dev` starts the Next.js development server.
- `bun run build` creates a production build.
- `bun run start` serves the production build.
