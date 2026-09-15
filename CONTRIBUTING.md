# Contributing

1. Create a focused branch.
2. Do not commit `.env`, `.ssh-nexus`, SSH configs, keys, tokens, host inventories, or terminal output.
3. Keep automatic remote operations read-only and time-bounded.
4. Add tests for parser, path-boundary, authentication, and process-launch changes.
5. Run `npm run check` before opening a pull request.

Use Conventional Commit-style messages when practical, for example `fix: preserve included SSH aliases`.

For a UI change, verify keyboard focus, 375 px mobile layout, 1440 px desktop layout, reduced motion, empty inventory, online/offline states, and a long hostname.
