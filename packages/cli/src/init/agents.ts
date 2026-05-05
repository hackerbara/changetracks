export { detectAgents } from '../agents/setup.js';
export type { AgentStatus } from '../agents/types.js';

import { setupAgentIntegrations } from '../agents/setup.js';
import type { AgentStatus } from '../agents/types.js';

export async function configureAgents(projectDir: string, agents: AgentStatus[]): Promise<string[]> {
  const include = agents.filter((agent) => agent.detected).map((agent) => agent.name);
  const results = await setupAgentIntegrations({
    cwd: projectDir,
    mode: 'project',
    include,
    dryRun: false,
    log: () => {},
  });
  return results.map((result) => result.message);
}
