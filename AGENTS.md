# Agent instructions

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/PROJECT_INDEX.md` before changing behavior.

- Treat this as privileged infrastructure software.
- Preserve local-only binding unless a token is required and documented.
- Never read, log, index, return, or commit private-key material, `.env` values, tokens, or full SSH configuration.
- Keep SSH destinations restricted to explicit aliases loaded server-side.
- Automatic remote operations must be fixed, read-only, non-interactive, and time-bounded.
- Arbitrary remote execution must remain opt-in and clearly annotated as destructive.
- Keep project paths inside `PROJECT_ROOTS`; skip symlinks and secret-like files.
- Make minimal changes, add tests, and run `npm run check`.
- Update the README and project map when commands, modules, or client configuration change.
