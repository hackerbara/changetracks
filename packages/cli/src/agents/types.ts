export type AgentName = 'claude' | 'cursor' | 'opencode' | 'codex';

export interface AgentStatus {
  name: AgentName;
  detected: boolean;
  configured: boolean;
}

export type AgentIntegrationStatus =
  | 'configured'
  | 'already-configured'
  | 'manual-action'
  | 'skipped'
  | 'failed';

export interface AgentIntegrationResult {
  agent: AgentName;
  status: AgentIntegrationStatus;
  message: string;
  repairCommand?: string;
  touchedFiles?: string[];
}

export interface DetectAgentsOptions {
  homeDir?: string;
  commandExists?: (cmd: string) => boolean;
}

export interface SetupAgentIntegrationsOptions extends DetectAgentsOptions {
  cwd: string;
  mode: 'word' | 'project';
  include: 'detected' | AgentName[];
  dryRun?: boolean;
  verbose?: boolean;
  requireConfigured?: boolean;
  log?: (message: string) => void;
}
