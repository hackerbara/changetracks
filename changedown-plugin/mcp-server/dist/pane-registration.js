// ../../packages/core/dist-esm/backend/types.js
function wordSessionResourceName(sessionUri) {
  return `Active Word Document (${sessionUri.split("/").pop() ?? sessionUri})`;
}

// src/pane-registration.ts
var WordPaneMuxBackend = class {
  constructor(getPaneHandle) {
    this.getPaneHandle = getPaneHandle;
  }
  schemes = ["word"];
  sessions = /* @__PURE__ */ new Map();
  addSession(session) {
    this.sessions.set(session.sessionUri, session);
  }
  removeRegistration(registrationId) {
    for (const [sessionUri, session] of this.sessions) {
      if (session.registrationId !== registrationId) continue;
      this.sessions.delete(sessionUri);
      return true;
    }
    return false;
  }
  isEmpty() {
    return this.sessions.size === 0;
  }
  list() {
    return Array.from(this.sessions.values()).map((session) => ({
      uri: session.sessionUri,
      name: wordSessionResourceName(session.sessionUri),
      mimeType: "text/markdown",
      version: session.version
    }));
  }
  async read(ref) {
    const session = this.resolve(ref);
    const snapshot = await this.getPaneHandle().sendRequest(
      session.registrationId,
      "read",
      {}
    );
    session.version = snapshot.version;
    return snapshot;
  }
  async listChanges(ref, _filter) {
    return this.getPaneHandle().sendRequest(
      this.resolve(ref).registrationId,
      "listChanges",
      _filter ?? {}
    );
  }
  async applyChange(ref, op) {
    return this.getPaneHandle().sendRequest(
      this.resolve(ref).registrationId,
      "applyChange",
      { op }
    );
  }
  subscribe(ref, listener) {
    const session = this.resolve(ref);
    this.getPaneHandle().sendRequest(session.registrationId, "subscribe", {}).catch((err) => console.warn("[WordPaneMuxBackend] subscribe ack failed:", err));
    const disposable = this.getPaneHandle().onPaneNotification(session.registrationId, (event) => {
      if (event.kind === "document_changed") session.version = event.version;
      listener(event);
    });
    return () => disposable.dispose();
  }
  resolve(ref) {
    const session = this.sessions.get(ref.uri);
    if (!session) {
      const known = Array.from(this.sessions.keys()).join(", ") || "(none)";
      throw new Error(`WordSessionNotFoundError: no active pane for ${ref.uri}; known sessions: ${known}`);
    }
    return session;
  }
};
function createPaneRegistrationCallbacks(getPaneHandle, registry) {
  const backend = new WordPaneMuxBackend(getPaneHandle);
  let registered = false;
  return {
    onRegister(info) {
      const sessionUri = info.sessionId.includes("://") ? info.sessionId : `${info.scheme}://${info.sessionId}`;
      backend.addSession({ registrationId: info.registrationId, sessionUri });
      if (!registered) {
        registry.register(backend);
        registered = true;
      } else {
        registry.register(backend);
      }
      console.error(
        `[changedown] pane registered \u2014 scheme="${info.scheme}" session="${info.sessionId}" regId="${info.registrationId}"`
      );
      return {
        dispose() {
        }
      };
    },
    onUnregister(registrationId) {
      const removed = backend.removeRegistration(registrationId);
      if (!removed) {
        console.error(
          `[changedown] stale unregister ignored \u2014 regId="${registrationId}" not active`
        );
        return;
      }
      if (backend.isEmpty()) {
        registry.unregister("word");
        registered = false;
      } else {
        registry.register(backend);
      }
      console.error(
        `[changedown] pane unregistered \u2014 regId="${registrationId}"`
      );
    }
  };
}
export {
  createPaneRegistrationCallbacks
};
//# sourceMappingURL=pane-registration.js.map
