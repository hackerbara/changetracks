import * as vscode from 'vscode';

/**
 * Shared output channel reference.
 * Provides a mutable reference that extension.ts sets after creation,
 * and managers read via getOutputChannel() for logging.
 */
let channel: vscode.OutputChannel | undefined;

export function setOutputChannel(ch: vscode.OutputChannel): void {
    channel = ch;
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
    return channel;
}
