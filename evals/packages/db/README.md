## Running Migrations

Update `src/schema.ts` as needed, and then run:

```sh
pnpm db:generate
```

Inspect the generated sql in the migration filed added to `drizzle/`.

If it looks okay, then run:

```sh
pnpm db:migrate
```
