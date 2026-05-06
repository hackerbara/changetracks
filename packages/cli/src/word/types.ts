export interface WordCommandContext {
  cwd: string;
}

export interface WordCommandOptions {
  manifest?: string;
  paneMode?: 'local' | 'hosted';
  dryRun?: boolean;
  noValidate?: boolean;
  noSideload?: boolean;
  verbose?: boolean;
  noAgents?: boolean;
  requireAgents?: boolean;
  noDownload?: boolean;
  /** Use Office dev certs for the HTTPS loopback bridge. Default true for hosted Word panes. */
  useDevCerts?: boolean;
  /** Explicit insecure HTTP fallback for diagnostics only. */
  noDevCerts?: boolean;
}

export interface WordSessionState {
  manifestPath: string;
  /** Reserved; not currently written. */
  mcpPid?: number;
  /** Reserved; not currently written. */
  mcpOwned?: boolean;
  startedAt: string;
  /** PID of the foreground `word start` process. `word stop` SIGTERMs this to
   * fire the cleanup handler that closes the pane server and un-sideloads. */
  startPid?: number;
  /** Port of the local HTTPS pane server, when started. */
  panePort?: number;
  /** Pane mode this session was started with. */
  paneMode?: 'local' | 'hosted';
}
