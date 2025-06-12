# @roo-code/types

### Publish to NPM

First authenticate with NPM:

```sh
npm login
```

Next, manually bump the NPM package version:

```sh
cd packages/types/npm && npm version minor && cd -
```

Finally, publish to NPM:

```sh
pnpm --filter @roo-code/types npm:publish
```

Note that you'll be asked for an MFA code to complete the publish.
