# Release Tag Audit: Dec 20, 2025 - Feb 9, 2026

## Scope

19 release tags from `v3.45.1` to `v3.57.1` (excluding CLI and nightly tags).

## TL;DR

**No evidence of a bad actor injecting malicious release tags.** All 19 tags were created by known Cline team members, all have matching `package.json` versions, all 18 that published successfully have corresponding GitHub Releases created through the official publish workflow, and the publish workflow was triggered only by 4 verified team members. However, there are process hygiene issues worth tightening.

---

## Tag-by-Tag Summary

| Tag | Tag Date | Commit Author | Commit Subject | Version Match | GitHub Release | Workflow Trigger | Verdict |
|-----|----------|---------------|----------------|---------------|----------------|------------------|---------|
| **v3.45.1** | Dec 20 | Saoud Rizwan | v3.45.1 Release Notes (hotfix) | OK | Yes | saoudrizwan | Clean |
| **v3.46.0** | Dec 22 | github-actions[bot] | v3.46.0 Release Notes (#8242) | OK | Yes | arafatkatze | Clean |
| **v3.46.1** | Dec 22 | Ara | feat: remove z-ai/glm-4.6 (#8260) | OK | Yes | arafatkatze | Clean (combined hotfix+release) |
| **v3.47.0** | Jan 6 | Ara | feat: remove kwaipilot/kat-coder-pro (#8406) | OK | Yes | arafatkatze | **Note 1** |
| **v3.48.0** | Jan 8 | github-actions[bot] | v3.48.0 Release Notes (#8407) | OK | Yes | arafatkatze | Clean |
| **v3.49.0** | Jan 9 | Ara | package update (#8499) | OK | Yes | arafatkatze | **Note 2** |
| **v3.49.1** | Jan 13 | Ara | Update Package lock.json for release (#8569) | OK | Yes | maxpaulus43 | Minor |
| **v3.50.0** | Jan 14 | github-actions[bot] | v3.50.0 Release Notes (#8574) | OK | Yes | arafatkatze | Clean |
| **v3.51.0** | Jan 15 | Tomas Barreiro | Refactor fetching remote config (#8115) | OK | Yes | maxpaulus43 | **Note 3** |
| **v3.52.0** | Jan 22 | github-actions[bot] | v3.52.0 Release Notes (#8633) | OK | **NO** (workflow failed) | arafatkatze (failed) | **Note 4** |
| **v3.53.0** | Jan 23 | github-actions[bot] | Changeset version bump (#8800) | OK | Yes | arafatkatze | Clean |
| **v3.53.1** | Jan 23 | Ara | chore(release): bump version to 3.53.1 (#8839) | OK | Yes | arafatkatze | Clean |
| **v3.54.0** | Jan 27 | github-actions[bot] | v3.54.0 Release Notes (#8840) | OK | Yes | arafatkatze | Clean |
| **v3.55.0** | Jan 27 | github-actions[bot] | Changeset version bump (#8895) | OK | Yes | candieduniverse | Clean |
| **v3.56.0** | Jan 29 | CandiedUniverse | Correct the version number (#8966) | OK | Yes | candieduniverse | Clean (version fix) |
| **v3.56.1** | Jan 29 | CandiedUniverse | Correct omega to giga (#8967) | OK | Yes | candieduniverse | Clean |
| **v3.56.2** | Jan 30 | CandiedUniverse | Version bump for rotated API key (#8983) | OK | Yes | candieduniverse | Clean |
| **v3.57.0** | Feb 5 | Ara | Update changelog wording (#9125) | OK | Yes | arafatkatze/maxpaulus43 | Minor |
| **v3.57.1** | Feb 5 | Max | update changelog for 3.57.1 (#9130) | OK | Yes | maxpaulus43 | Clean |

## Notes on Flagged Tags

### Note 1 - v3.47.0

Tag placed 1 commit *after* the proper "v3.47.0 Release Notes" commit (`333468c9b`). The tagged commit removes a model from the free list but isn't documented in the changelog. Likely a "squeeze in one more fix before publishing" situation. The parent commit is the real release commit.

### Note 2 - v3.49.0

Tag is 2 commits after the "v3.49.0 Release Notes" commit. Two "package update" commits by Ara stacked on top:
- `f526f70e3` re-bumped version from 3.48.1 to 3.49.0 (suggesting the release notes commit had a wrong version)
- `94160faee` (the tagged commit) made code changes to `cline.ts` provider and `OpenRouterModelPicker.tsx`

Neither extra commit is documented in the changelog.

### Note 3 - v3.51.0

**Most notable tag placement.** The tag is on an external contributor's refactoring PR (#8115 by Tomas Barreiro) that has nothing to do with a release. There is no proper "Release Notes" commit for v3.51.0. The version bump was embedded in the prior commit ("gpt 5.2 codex banner fix and version bump"). The tagged commit's code change is not in the changelog.

### Note 4 - v3.52.0

Tag exists and points to a clean "Release Notes" commit by `github-actions[bot]`, but the publish workflow **failed** (run 224, triggered by arafatkatze). This means v3.52.0 was likely **never published to the VS Code Marketplace**. No GitHub Release exists for it. This is a dangling tag.

---

## Who Triggered Publish Workflows

| Person | GitHub Username | Role | Runs | Successful |
|--------|----------------|------|------|------------|
| Saoud Rizwan | saoudrizwan | Cline founder, #1 committer (2396 commits) | 2 | 1 |
| Ara | arafatkatze | Cline team, has origin branches, primary release manager | 18 | 10 |
| Eve Killaby | candieduniverse | Cline core engineer, hooks system owner (305 commits) | 5 | 5 |
| Max | maxpaulus43 | Cline team (max@cline.bot) | 4 | 4 |

All 4 are verified Cline team members. The publish workflow requires the `publish` GitHub environment (environment protection), and the changeset-converter checks for "deployer" team membership.

### Identity Note: CandiedUniverse / cline-test

The "CandiedUniverse" / "cline-test" committer that appeared on v3.56.0-v3.56.2 is **Eve Killaby**, a core Cline engineer with 305 commits. The three names (Eve Killaby, CandiedUniverse, cline-test) all share the same GitHub user ID (132302818). "cline-test" is simply a local git config name on their dev machine. All 3 PRs (#8966, #8967, #8983) were reviewed and approved by other team members.

---

## Structural Observations

1. **All tags are lightweight** (not annotated) -- no tagger identity or GPG signature. Anyone with push access can create/move/delete them silently.

2. **Two lineage breaks** in the tag chain:
   - `v3.45.1 -> v3.46.0`: v3.45.1 was a hotfix branched from v3.45.0; v3.46.0 continued from main. Normal hotfix pattern (common ancestor: v3.45.0).
   - `v3.56.2 -> v3.57.0`: Similar branching, sharing v3.56.0 as common ancestor.

3. **Tags are not on current origin/main HEAD.** This is because main has been force-pushed/rebased since these tags were created. The tags preserve the original commit history at their point in time.

---

## Risk Assessment

**No evidence of compromise found.** All releases trace back to legitimate team members through both the git commit chain and the GitHub Actions workflow trigger logs. However, the following process weaknesses could be exploited:

### 1. Lightweight tags can be moved or spoofed
Anyone with push access can create, move, or delete lightweight tags with no audit trail. Annotated + GPG-signed tags would provide cryptographic proof of who created them and prevent silent modification.

### 2. Tag-to-commit alignment is inconsistent
Several tags land on non-release commits (v3.47.0, v3.49.0, v3.51.0). This means the published `.vsix` artifact may include code changes not documented in the release notes/changelog. A policy of only tagging on the actual release notes/version bump commit would make audits cleaner.

### 3. The publish workflow trusts any pre-existing tag
The workflow validates that the tag *exists*, but not *who created it* or *what it points to*. If an attacker gained repo push access and created a tag on a malicious commit, they could trigger a publish (if they also had access to the `publish` environment). Adding tag signature verification to the workflow would mitigate this.

### 4. Dangling tag: v3.52.0
This tag exists but was never published (workflow failed). Not harmful, but indicates incomplete cleanup. Consider deleting tags for failed releases.

---

## Recommendations

1. **Switch to annotated + signed tags** for releases to create cryptographic provenance.
2. **Add tag verification to the publish workflow** -- verify the tag was created by an authorized team member and points to a commit on the main branch.
3. **Enforce tag-on-release-commit policy** -- tags should only be placed on "Release Notes" or "Changeset version bump" commits, not on subsequent unrelated commits.
4. **Clean up v3.52.0** -- either publish it or delete the dangling tag.
5. **Protect the main branch from force-pushes** if not already done -- force-pushes break the tag-to-main ancestry chain and make auditing harder.
