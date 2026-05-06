# @changedown/cli

Track changes in markdown — for humans and AI agents.

CLI and change-tracking engine. Provides `npx @changedown/cli init` for project setup, plus the core engine used by editor extensions and agent plugins.

See [ChangeDown](https://github.com/hackerbara/changedown) for full documentation.

## Upgrading

### Upgrading from v0.4.3

- The `cli` binary alias has been restored for scoped-package `npx` inference,
  so `npx @changedown/cli@latest word start` works again. You can still use
  `changedown` for project commands or `cdown` for engine/MCP commands.
- `word stop` now reliably closes the local pane server when run from a
  different shell — it signals the foreground `word start` process which
  runs its existing cleanup handler.
[^cn-1]
## License

MIT
