# Skills inventory

Back to [drivecode reference](README.md).

This fork has project skills under `.agents/skills/` and `.cline/skills/`. There
is no in-repo `cline/skills/` directory. The community catalog is
[`github.com/cline/skills`](https://github.com/cline/skills), installed into
`~/.cline/skills/` via the marketplace / `npx skills add … -a cline`.

Cline discovers project skills from (among others) `.cline/skills`,
`.agents/skills`, and `.clinerules/skills`. Skills are on-demand (`use_skill` /
slash); rules in `.clinerules` / `AGENTS.md` are always-on.

## In-repo today

| Skill | Home | Classification |
|---|---|---|
| **audit-links** | `.agents/skills/audit-links/` → [`sdk/scripts/check-links.ts`](../../sdk/scripts/check-links.ts) | Monorepo **docs tooling**. Not Drive. Strong candidate for a **generalized** publish to `cline/skills` (portable checker or clear BYO-script contract). Keep the in-repo copy for CI and relative paths. |
| **create-pull-request** | `.agents/skills/create-pull-request/` | Upstream **contributor** tooling → catalog candidate if not already published. |
| **opentui** | `.agents/skills/opentui/` | Upstream **TUI contributor** skill → catalog candidate for CLI maintainers. |
| **cline-sdk** | `.agents/skills/cline-sdk/` | Upstream product skill; already aligned with `cline/sdk-skill` / marketplace. |
| **diagram-first** | `.agents/skills/diagram-first/` (+ `.cline/skills/diagram-first/`) | Structural Mermaid for nest architecture / ARDs / ops. Backed by `@cline/drive` `validateMermaidSource` + `bun sdk/scripts/validate-mermaid.ts`. |
| **diagram-show** | `.agents/skills/diagram-show/` (+ `.cline/skills/diagram-show/`) | Drive Show `diagram.*` via `SHOW_TEMPLATE_KIT` + `drive.show.*`. Fail-closed parse gate. |
| **publish-cli / publish-desktop / publish-ui** | `.cline/skills/` | Release-only for this monorepo. **Do not** publish to the community catalog. |

## Drive product skills (planned, not shipped)

Ported from cursor-drive under [DRV-SKILL-PORT](./plans/cline-drivemode/features/DRV-SKILL-PORT.md)
and [DRV-SDLC-GUIDE](./plans/cline-drivemode/features/DRV-SDLC-GUIDE.md):

- `drive-persona`
- `drive-modes`
- `drive-concise`
- `sdlc-guidance`

These must load **only when Drive is on**. They are not candidates for the
public `cline/skills` catalog.

## Product surfaces that are not skills

Status Hub (Board, Changelog, Dependency map), Spotlight, and Drive call chrome
are hub UI. Optional later: Drive-conditional playbooks such as “read the board”
or “explain the task graph” — still not public catalog skills.

## Packaging notes

```text
my-skill/
├── SKILL.md          # YAML frontmatter: name, description
├── docs/             # optional progressive refs
├── scripts/          # optional helpers
└── templates/        # optional
```

| Audience | Path |
|---|---|
| This monorepo | Prefer `.cline/skills/<name>/` (`.agents/skills/` also loads) |
| User global | `~/.cline/skills/` |
| Community share | Publish to [`cline/skills`](https://github.com/cline/skills) |
| Drive-only | DRV-SKILL-PORT homes; conditional on Drive |

**Out of scope until deliberately scheduled:** relocating `audit-links` into
`.cline/skills/`, publishing a generalized link auditor to `cline/skills`, or
implementing DRV-SKILL-PORT.
