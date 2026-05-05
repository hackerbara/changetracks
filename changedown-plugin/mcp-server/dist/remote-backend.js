// ../../packages/core/dist-esm/backend/types.js
function wordSessionResourceName(sessionUri) {
  return `Active Word Document (${sessionUri.split("/").pop() ?? sessionUri})`;
}

// src/remote-backend.ts
var RemoteBackend = class {
  constructor(paneHandle, registrationId, sessionUri) {
    this.paneHandle = paneHandle;
    this.registrationId = registrationId;
    this.sessionUri = sessionUri;
  }
  schemes = ["word"];
  /** Session URI, e.g. "word://sess-<uuid>". Exposed for Tranche 6's list() impl. */
  sessionUri;
  list() {
    return [{
      uri: this.sessionUri,
      name: wordSessionResourceName(this.sessionUri),
      mimeType: "text/markdown",
      // Version tracking deferred — no _lastKnownVersion field; agents poll read().
      version: void 0
    }];
  }
  async read(_ref) {
    return this.paneHandle.sendRequest(
      this.registrationId,
      "read",
      {}
    );
  }
  async listChanges(_ref, _filter) {
    return this.paneHandle.sendRequest(
      this.registrationId,
      "listChanges",
      _filter ?? {}
    );
  }
  async applyChange(_ref, op) {
    return this.paneHandle.sendRequest(
      this.registrationId,
      "applyChange",
      { op }
    );
  }
  /**
   * Send the subscribe RPC so the pane knows it's being observed, then wire
   * the actual notification delivery via onPaneNotification. The pane POSTs
   * to /backend/notify/:registrationId on each Observer delta; those events
   * arrive here and are forwarded to the listener, which feeds fanOut().
   */
  subscribe(_ref, listener) {
    this.paneHandle.sendRequest(this.registrationId, "subscribe", {}).catch((err) => console.warn("[RemoteBackend] subscribe ack failed:", err));
    const disposable = this.paneHandle.onPaneNotification(this.registrationId, (event) => {
      listener(event);
    });
    return () => disposable.dispose();
  }
};
export {
  RemoteBackend
};
//# sourceMappingURL=remote-backend.js.map
