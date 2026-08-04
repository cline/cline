# Settings built-in skill

The `cline-settings` built-in skill
(`sdk/packages/core/src/extensions/config/builtin-skills.ts`) tells models
where Cline stores settings. Its path lists come from the resolvers in
`sdk/packages/shared/src/storage/paths.ts`, so path changes flow through
automatically.

When you add, move, or remove a settings file, storage directory, or
config search location, check whether the skill's categories and prose
still describe it. Update `builtin-skills.ts` if not.
