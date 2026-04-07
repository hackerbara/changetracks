/**
 * View Mode Notifications
 *
 * Custom LSP notifications for synchronizing view mode between client and server:
 * - changedown/setViewMode (client -> server): Client requests view mode change
 * - changedown/viewModeChanged (server -> client): Server confirms mode change
 */

import { Connection } from 'vscode-languageserver';
import type { ViewMode } from '@changedown/core';
import { LSP_METHOD } from '@changedown/core/host';

/**
 * Parameters for setViewMode notification (client -> server)
 */
export interface SetViewModeParams {
  textDocument: { uri: string };
  viewMode: ViewMode;
}

/**
 * Parameters for viewModeChanged notification (server -> client)
 */
export interface ViewModeChangedParams {
  textDocument: { uri: string };
  viewMode: ViewMode;
}

/**
 * Send viewModeChanged notification to client.
 *
 * Broadcasts the current view mode for a document back to the client,
 * confirming that the server has updated its stored mode.
 *
 * @param connection LSP connection
 * @param uri Document URI
 * @param viewMode The active view mode
 */
export function sendViewModeChanged(
  connection: Connection,
  uri: string,
  viewMode: ViewMode
): void {
  const params: ViewModeChangedParams = {
    textDocument: { uri },
    viewMode
  };
  connection.sendNotification(LSP_METHOD.VIEW_MODE_CHANGED, params);
}
