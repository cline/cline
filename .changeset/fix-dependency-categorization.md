---
"claude-dev": patch
---

fix: correct dependency categorization in package.json

Move build-time tools (@tailwindcss/vite, tailwindcss, archiver, ts-morph), test framework (@playwright/test), and type definitions (@types/uuid) from dependencies to devDependencies. Move tree-kill from devDependencies to dependencies as it's used in production code.

This fixes npm install errors caused by duplicate tailwind deps that were inadvertently added to root package.json in v3.35.0.
