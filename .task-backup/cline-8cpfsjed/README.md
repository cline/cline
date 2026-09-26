# Task backup — `cline/8cpfsjed`

Scratch artifact preserved from a sandbox session before expiry.

## Context

The task was a standalone exercise, unrelated to the Cline monorepo source:

> Print 25 to 1 in descending and ascending and print in such style it creates
> a square pattern.

No monorepo files were modified for this task — the working tree was clean. The
script originally lived at `/tmp/square-pattern.ts` (outside the repo), so it is
copied here purely so the work survives sandbox teardown.

## Contents

- `square-pattern.ts` — prints 25..1 and 1..25 as aligned 5x5 grids.

## Run it

```bash
bun .task-backup/cline-8cpfsjed/square-pattern.ts
```

Verified with bun 1.4.2. Output:

```
Descending square (25 -> 1):
25 24 23 22 21
20 19 18 17 16
15 14 13 12 11
10  9  8  7  6
 5  4  3  2  1

Ascending square (1 -> 25):
 1  2  3  4  5
 6  7  8  9 10
11 12 13 14 15
16 17 18 19 20
21 22 23 24 25
```

## Notes

- 25 = 5^2, so the values tile a perfect 5x5 square (`SIDE = Math.sqrt(TOTAL)`).
- Cells are right-aligned via `padStart` to the widest number's width, which keeps
  the columns flush once numbers drop to a single digit.
- Changing `TOTAL` to another perfect square (16, 36, 100, ...) resizes both grids
  automatically. A non-perfect-square value yields a fractional side and a ragged
  grid; that case is not handled.

This directory is scratch/backup only — it is not part of the build and nothing
in the monorepo references it.
