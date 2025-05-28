# Monorepo Guide

Roo Code has transitioned to a monorepo powered by [PNPM workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turborepo.com).

When you first pull down the monorepo changes from git you'll need to re-install all packages using pnpm. You can install pnpm using [these](https://pnpm.io/installation) instructions. If you're on MacOS the easiest option is to use Homebrew:

```sh
brew install pnpm
```

Once pnpm is installed you should wipe out your existing node_modules directories for a fresh start:

```sh
# This is optional, but recommended.
find . -name node_modules | xargs rm -rvf
```

And then install your packages:

```sh
pnpm install
```

If things are in good working order then you should be able to build a vsix and install it in VSCode:

```sh
pnpm build -- --out ../bin/roo-code-main.vsix && \
  code --install-extension bin/roo-code-main.vsix
```

To fully stress the monorepo setup, run the following:

```sh
pnpm clean && pnpm lint
pnpm clean && pnpm check-types
pnpm clean && pnpm test
pnpm clean && pnpm bundle
pnpm clean && pnpm build
pnpm clean && pnpm npx turbo watch:bundle
pnpm clean && pnpm npx turbo watch:tsc
cd apps/vscode-e2e && pnpm test:ci
```
