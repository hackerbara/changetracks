import { EventEmitter, type LspConnection, type Disposable } from '../types.js';

export class TrackingService implements Disposable {
  private trackingState = new Map<string, boolean>();
  private disposables: Disposable[] = [];

  readonly onDidChangeTrackingState = new EventEmitter<{ uri: string; enabled: boolean }>();

  constructor(private connection: LspConnection) {
    this.disposables.push(
      connection.onNotification('changedown/documentState', (params: any) => {
        const uri = params.textDocument?.uri;
        const enabled = params.tracking?.enabled ?? false;
        if (uri) {
          this.trackingState.set(uri, enabled);
          this.onDidChangeTrackingState.fire({ uri, enabled });
        }
      }),
    );
  }

  isTrackingEnabled(uri: string): boolean {
    return this.trackingState.get(uri) ?? false;
  }

  toggleTracking(uri: string): void {
    const enabled = !this.isTrackingEnabled(uri);
    this.setTrackingEnabled(uri, enabled);
  }

  setTrackingEnabled(uri: string, enabled: boolean): void {
    this.trackingState.set(uri, enabled);
    this.connection.sendNotification('changedown/setDocumentState', {
      textDocument: { uri },
      tracking: { enabled },
    });
    // Fire optimistically so UI updates immediately without waiting for
    // the server's documentState round-trip (which will fire again — harmless)
    this.onDidChangeTrackingState.fire({ uri, enabled });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.onDidChangeTrackingState.dispose();
  }
}
