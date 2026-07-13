# Learning Pack v1 Contract

AI-Hydro owns the canonical public schema for local Learning Pack archives at
`schemas/learning-pack/v1/pack.schema.json`.

This first contract is deliberately limited to pure, in-memory validation. It
defines package identity, course/module ownership, runtime compatibility,
terminal-equivalent Python disclosure, canonical JSON, SHA-256 inventory, and
Ed25519 signature verification.

It does not yet install or extract archives, persist publisher trust, add remote or
marketplace transport, install dependencies, authorize instructor roles, sandbox
Python, or make client-side quizzes secure.

The signature binds the exact bytes in `checksums.json` to an Ed25519 key. AI-Hydro
derives the key fingerprint from the verified public key. A valid signature from an
unknown key is not publisher verification and will require an explicit trust
decision when installation is implemented.
