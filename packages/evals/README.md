# Run Roo Code Evals

## Get Started

NOTE: This is MacOS only for now!

Clone the Roo Code repo:

```sh
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code
```

Run the setup script:

```sh
cd packages/evals
./scripts/setup.sh
```

Navigate to [localhost:3000](http://localhost:3000/) in your browser.

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
