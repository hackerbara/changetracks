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
  mcpPid?: number;
  mcpOwned: boolean;
  startedAt: string;
}
