## Running Migrations

Update `src/schema.ts` as needed, and then run:

```sh
pnpm db:generate
```

Inspect the sql in the migration file added to `drizzle/`.

If it looks okay, then run:

```sh
pnpm db:migrate
```
