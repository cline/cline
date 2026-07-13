# Learning Pack v1 Contract

AI-Hydro owns the canonical public schema for local Learning Pack archives at
`schemas/learning-pack/v1/pack.schema.json`.

The contract defines package identity, course/module ownership, runtime
compatibility, terminal-equivalent Python disclosure, canonical JSON, SHA-256
inventory, and Ed25519 signature verification. Archive inspection happens before
installation and without extracting unverified content.

The v1 archive inspector enforces a 256 MiB compressed limit, 512 MiB total
uncompressed limit, 10,000-entry limit, and 64 MiB per-file limit. It rejects
encrypted entries, symbolic links, undeclared layout roots, traversal and
platform-ambiguous paths, and Unicode normalization or full case-folding
collisions. After preflight, it streams file bytes into the same canonical
contract validator and returns a defensive, immutable inspection result.

It does not yet expose installation commands or resolve installed packs into the
course runtime. It does not add remote or marketplace transport, install
dependencies, authorize instructor roles, sandbox Python, or make client-side
quizzes secure.

## Transactional lifecycle

The lifecycle service consumes only a valid immutable archive inspection. A
cancelled approval returns before creating storage. Install Once approves only the
exact inspected archive; Trust Publisher and Install adds the derived fingerprint
to the atomic local trust store as part of the same recoverable transaction.

Install, rollback, and removal use a per-pack cross-process lock plus a short
registry lock for ownership collision safety. Staging and activation remain on the
same filesystem. The persisted journal advances through `preflight`, `staged`,
`verified`, `registry-prepared`, `activated`, `committed`, and
`cleanup-complete`. Recovery rolls pre-commit work back and completes post-commit
cleanup, and is safe to repeat.

Normal upgrades require greater SemVer precedence. Identical same-version content
is a no-op; altered same-precedence content and direct downgrades are rejected.
Prerelease targets require explicit opt-in. The registry retains only the active
version and one verified predecessor. Removal deletes their pack-owned directories
and registry record while leaving publisher trust and learning/runtime state
untouched.

Command-palette UI, legacy-registry discovery, scoped course/control integration,
and installed-pack CSP remain separate runtime-integration work.

The signature binds the exact bytes in `checksums.json` to an Ed25519 key. AI-Hydro
derives the key fingerprint from the verified public key. A valid signature from an
unknown key is not publisher verification and will require an explicit trust
decision when installation is implemented.
