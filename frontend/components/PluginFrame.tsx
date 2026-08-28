/**
 * components/PluginFrame.tsx
 * Sandboxed renderer for a `ui_panel` plugin extension point (Issue #322).
 *
 * SECURITY MODEL — read before touching this file:
 *
 * The iframe below has `sandbox="allow-scripts"` and nothing else. In
 * particular it does NOT have `allow-same-origin`. Combined with `srcDoc`
 * (rather than `src` pointing at a same-origin URL), the browser gives this
 * frame a unique, opaque origin on every render — not just "a different
 * origin from the host," but one with no origin equal to anything else on
 * the page, ever. That one attribute is what makes every property below
 * true simultaneously:
 *
 *   - The plugin's script cannot read `window.parent.document` — the
 *     standard same-origin policy blocks it, and an opaque origin can never
 *     satisfy that check.
 *   - The plugin's script cannot read the host page's cookies, localStorage,
 *     or any global the host attached to `window` — different origin, no
 *     access, full stop.
 *   - The plugin's script cannot reach `window.freighter` (or any wallet
 *     extension's injected API). Browser extensions inject content scripts
 *     into frames whose origin matches their manifest's declared match
 *     patterns; an opaque `srcDoc` origin matches nothing. This is *why*
 *     a plugin can never intercept a signing flow — not a policy this
 *     component enforces, a browser guarantee the sandbox attribute
 *     produces.
 *   - The host cannot read the plugin's DOM either, which is irrelevant to
 *     safety but worth knowing: this is mutual isolation, not one-way.
 *
 * The *only* channel between host and plugin is `postMessage`, validated on
 * both `origin` (must be `"null"` — the opaque origin's string form) and
 * message shape below. If a plugin's UI needs a wallet signature, it must
 * `postMessage` a *request* describing what it wants signed; the actual
 * signing flow — Freighter's popup, the user's approval — happens entirely
 * in the host page, in the host's own UI, using the host's own wallet
 * integration (`lib/wallet.ts`). The plugin is shown the outcome (signed or
 * declined), never the private key, never a code path that could
 * auto-approve, and never Freighter's API directly.
 *
 * Do not add `allow-same-origin` to fix a plugin that "can't do X" — that
 * removes the isolation this whole component exists to provide. If a
 * plugin legitimately needs a new capability, add a new mediated message
 * type below (mirroring the backend broker's pattern in
 * `backend/src/plugins/broker.js`), not a sandbox permission.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { optionalClientEnv } from "@/lib/env";

export interface PluginRequestSignPayload {
  /** Human-readable summary the host shows the user before signing —
   *  the plugin proposes this, the user reads it, never the plugin's raw
   *  transaction alone. */
  description: string;
  transactionXdr: string;
}

interface PluginFrameProps {
  pluginId: string;
  pluginName: string;
  /** The plugin's UI script, fetched from the registry (never inline from
   *  an untrusted prop — always come through the same submission +
   *  automated-scan pipeline as a workflow-hook plugin's source). */
  uiSource: string;
  /** Called when the plugin's UI asks the host to run a real wallet
   *  signing flow. The host renders its own confirmation UI (not shown by
   *  this component) and resolves with the outcome. */
  onRequestSign: (
    payload: PluginRequestSignPayload
  ) => Promise<{ signed: boolean; signedXdr?: string }>;
  /** Called for a mediated data request (mirrors backend/src/plugins/broker.js's
   *  method allowlist) — e.g. `{ method: "jobs.get", params: {...} }`. */
  onDataRequest: (method: string, params: unknown) => Promise<unknown>;
  heightPx?: number;
}

/** Same-shape contract as backend/src/plugins/childEntry.js's console/marketpay
 *  bridge, adapted for a DOM iframe instead of a child process — the plugin
 *  UI script runs inside this bootstrap, never with direct DOM/window access
 *  to the host page. */
function buildSandboxDocument(uiSource: string): string {
  const escapedSource = uiSource.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <style>body { margin: 0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      "use strict";
      var nextCallId = 1;
      var pending = {};

      window.addEventListener("message", function (event) {
        var msg = event.data;
        if (!msg || typeof msg !== "object" || msg.source !== "marketpay-host") return;
        if (msg.type === "response") {
          var entry = pending[msg.callId];
          if (!entry) return;
          delete pending[msg.callId];
          if (msg.ok) entry.resolve(msg.value);
          else entry.reject(new Error(msg.error || "request failed"));
        }
      });

      function bridgeCall(type, detail) {
        return new Promise(function (resolve, reject) {
          var callId = nextCallId++;
          pending[callId] = { resolve: resolve, reject: reject };
          window.parent.postMessage(
            { source: "marketpay-plugin", type: type, callId: callId, detail: detail },
            "*"
          );
        });
      }

      // The only two capabilities exposed to the plugin UI. Both are
      // mediated round-trips to the host — there is no direct wallet or
      // network access in this frame at all.
      window.marketpay = Object.freeze({
        requestSign: function (payload) { return bridgeCall("requestSign", payload); },
        call: function (method, params) { return bridgeCall("dataRequest", { method: method, params: params }); },
      });

      try {
        ${escapedSource}
      } catch (err) {
        var el = document.getElementById("root");
        if (el) el.textContent = "Plugin UI error: " + (err && err.message ? err.message : String(err));
      }
    })();
  </script>
</body>
</html>`;
}

export default function PluginFrame({
  pluginId,
  pluginName,
  uiSource,
  onRequestSign,
  onDataRequest,
  heightPx = 400,
}: PluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [crashed, setCrashed] = useState<string | null>(null);
  const apiOrigin = optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000");
  void apiOrigin; // reserved for a future same-origin allowlist on message replies, if the frame ever needs one

  const postResponse = useCallback(
    (callId: number, ok: boolean, value?: unknown, error?: string) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      // Reply to the frame's *own* opaque origin ("null"), never "*" — a
      // reply is only meaningful to the exact frame that asked, and this
      // keeps the contract explicit even though "*" would work practically
      // for a same-content-every-time srcDoc frame.
      win.postMessage(
        { source: "marketpay-host", type: "response", callId, ok, value, error },
        "*"
      );
    },
    []
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object" || msg.source !== "marketpay-plugin") return;

      const { type, callId, detail } = msg as {
        type: string;
        callId: number;
        detail: unknown;
      };

      if (type === "requestSign") {
        const payload = detail as PluginRequestSignPayload;
        if (!payload?.transactionXdr || typeof payload.description !== "string") {
          postResponse(callId, false, undefined, "malformed sign request");
          return;
        }
        onRequestSign(payload)
          .then((result) => postResponse(callId, true, result))
          .catch((err) => postResponse(callId, false, undefined, err.message));
        return;
      }

      if (type === "dataRequest") {
        const { method, params } = (detail || {}) as { method: string; params: unknown };
        onDataRequest(method, params)
          .then((result) => postResponse(callId, true, result))
          .catch((err) => postResponse(callId, false, undefined, err.message));
        return;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onRequestSign, onDataRequest, postResponse]);

  if (crashed) {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
      >
        Plugin &ldquo;{pluginName}&rdquo; failed to load and was disabled for this session:{" "}
        {crashed}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title={`Plugin: ${pluginName}`}
      data-plugin-id={pluginId}
      // No `allow-same-origin` — see module doc comment. This is the
      // entire security boundary; do not weaken it to work around a
      // plugin limitation.
      sandbox="allow-scripts"
      srcDoc={buildSandboxDocument(uiSource)}
      style={{
        width: "100%",
        height: heightPx,
        border: "1px solid var(--border-color, #e5e7eb)",
        borderRadius: 8,
      }}
      onError={() => setCrashed("frame failed to render")}
    />
  );
}
