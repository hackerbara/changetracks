import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';
import { setContextKey } from '../managers/shared';

export async function toggleTracking(controller: BaseController): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return;
    const uri = editor.document.uri.toString();
    const enabled = !controller.isTrackingEnabled(uri);
    controller.trackingService.setTrackingEnabled(uri, enabled);
    setContextKey('changedown:trackingEnabled', enabled);
    vscode.window.showInformationMessage(`ChangeDown: Tracking ${enabled ? 'enabled' : 'disabled'}`);
}
