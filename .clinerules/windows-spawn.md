# Windows `.cmd` wrappers

Node package commands are often `.cmd` wrappers on Windows and may require
`shell: true`, but a shell reinterprets interpolated arguments. For commands
with caller-, config-, or catalog-supplied arguments, use the shell-free helpers
and guidance in `sdk/packages/shared/src/spawn.ts` (`@cline/shared/node`).
