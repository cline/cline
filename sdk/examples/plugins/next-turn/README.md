# Next Turn

Next Turn is a Cline plugin that, after each root turn, offers up to three next actions in the composer. It uses one hook (`afterRun`) and one slot (`composer.suggestions`): `use` and `send` accept a row the current set still offers (or, until a restarted worker serves its first set, the set it withdrew), `skip` and `unskip` drop and restore one row, named from any set this turn, for the rest of the turn, `refresh` serves the next set (its `more` cause, Skip on the last row, drops that row), and `hide` and `show` turn the tray off and on for the chat. Every state the plugin publishes carries a new revision, so `use`, `send` and `refresh` aimed at a set it has replaced are refused as stale. Only the turn that just finished counts, not earlier turns in the chat. A stopped turn leads with Resume, a failed turn or errored tool with Fix, a completed turn that edited files adds Verify and Review, and every turn ends at Next step. Nothing is persisted: when the plugin's worker restarts (a session reload, or a reclaim after 30 idle minutes) it withdraws the set it held and never reissues that set's revision, and a chat hidden with `hide` shows suggestions again from the next turn.

Not here on purpose: tracked task rows, a Status Hub (cross-chat rollups) and a model planner (a prompt and label schema) — each needs its own product, not a third row in this example.

```sh
bun run check
```
