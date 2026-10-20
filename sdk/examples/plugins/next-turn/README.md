# Next Turn

Next Turn is a Cline plugin that, after each root turn, offers up to three next actions in the composer. It uses one hook (`afterRun`) and one slot (`composer.suggestions`): `use` and `send` accept a row, `skip` and `refresh` page forward, `hide` and `show` manage the set, and a stale revision is refused. A stopped turn leads with Resume, a failed turn or errored tool with Fix, a completed turn that edited files adds Verify and Review, and every turn ends at Next step.

Not here on purpose: tracked task rows, a Status Hub (cross-chat rollups) and a model planner (a prompt and label schema) — each needs its own product, not a third row in this example.

```sh
bun run check
```
