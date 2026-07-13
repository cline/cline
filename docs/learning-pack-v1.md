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

It does not yet install or extract archives into runtime state, persist publisher
trust, add remote or marketplace transport, install dependencies, authorize
instructor roles, sandbox Python, or make client-side quizzes secure.

The signature binds the exact bytes in `checksums.json` to an Ed25519 key. AI-Hydro
derives the key fingerprint from the verified public key. A valid signature from an
unknown key is not publisher verification and will require an explicit trust
decision when installation is implemented.
