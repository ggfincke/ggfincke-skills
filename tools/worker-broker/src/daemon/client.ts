// tools/worker-broker/src/daemon/client.ts
// connect-or-spawn daemon client over the pinned wire protocol

import type { BrokerConfig } from '../contracts.js'
import type { DaemonClient } from './protocol.js'

export interface ConnectOptions
{
  // spawn a daemon from this client's dist when none is listening
  spawn?: boolean
}

// * pinned entry point: frontends compile against this signature; the implementation lands separately
export async function connectDaemon(
  config: BrokerConfig,
  options: ConnectOptions = {}
): Promise<DaemonClient>
{
  void config
  void options
  throw new Error('daemon client not implemented yet')
}

// spawn when needed and reconcile a build mismatch by draining an idle stale daemon
export async function ensureDaemonClient(
  config: BrokerConfig
): Promise<DaemonClient>
{
  return connectDaemon(config, { spawn: true })
}
