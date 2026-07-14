import { useEffect, useMemo, useRef, useState } from 'react';
import { MCPAppBridge } from './bridge';
import {
  MCP_APP_DEFAULT_INNER_SANDBOX,
  MCP_APP_DEFAULT_OUTER_SANDBOX,
  getMCPAppAllowAttribute,
  getMCPAppCSP,
} from './sandbox';
import type { MCPAppFrameProps } from './types';
import { normalizeMCPAppToolResult } from './utils';

/**
 * Derives a concrete, serialized origin for the sandbox proxy. An explicit
 * target may account for a known redirect, but wildcard and opaque targets are
 * rejected so bridge traffic always fails closed.
 */
export function deriveTargetOrigin(
  url: string,
  configuredOrigin?: string,
): string {
  const value = configuredOrigin?.trim() ?? url;
  if (value === '*') {
    throw new Error('MCP App sandbox targetOrigin must not be "*"');
  }

  let origin: string;
  try {
    origin =
      configuredOrigin == null
        ? new URL(value, window.location.href).origin
        : new URL(value).origin;
  } catch {
    throw new Error(`Invalid MCP App sandbox origin: ${value}`);
  }

  if (origin === 'null') {
    throw new Error(`MCP App sandbox origin must be concrete: ${value}`);
  }

  return origin;
}

function sendToolState({
  bridge,
  input,
  output,
}: {
  bridge?: MCPAppBridge;
  input: unknown;
  output: unknown;
}) {
  if (bridge == null) {
    return;
  }

  if (input !== undefined) {
    bridge.sendToolInput(input);
  }

  if (output !== undefined) {
    bridge.sendToolResult(normalizeMCPAppToolResult(output));
  }
}

function useSessionKey(identity: readonly unknown[]): number {
  const [session, setSession] = useState(() => ({ identity, key: 0 }));
  const changed =
    session.identity.length !== identity.length ||
    session.identity.some((value, index) => !Object.is(value, identity[index]));

  if (!changed) {
    return session.key;
  }

  // React immediately retries this component before committing its children,
  // so the old iframe never receives the new security-sensitive props.
  const nextSession = { identity, key: session.key + 1 };
  setSession(nextSession);
  return nextSession.key;
}

export function MCPAppFrame(props: MCPAppFrameProps) {
  const { app, resource, sandbox, hostInfo } = props;
  const sandboxUrl = String(sandbox.url);
  const targetOrigin =
    typeof window === 'undefined'
      ? undefined
      : deriveTargetOrigin(sandboxUrl, sandbox.targetOrigin);
  const resourceCSP = getMCPAppCSP(resource.meta?.csp);
  const resourceAllow = getMCPAppAllowAttribute(
    resource.meta?.permissions,
    sandbox.allowedPermissions,
  );
  const innerSandbox = sandbox.innerSandbox ?? MCP_APP_DEFAULT_INNER_SANDBOX;
  const outerSandbox = sandbox.outerSandbox ?? MCP_APP_DEFAULT_OUTER_SANDBOX;

  // A security-sensitive change must destroy the proxy browsing context, not
  // just replace its bridge. Comparing effective primitive values avoids both
  // needless reloads and copying potentially large HTML into a React key.
  const sessionKey = useSessionKey([
    sandboxUrl,
    targetOrigin,
    outerSandbox,
    innerSandbox,
    app.resourceUri,
    resource.uri,
    resource.html,
    resourceCSP,
    resourceAllow,
    hostInfo?.name ?? 'ai-sdk-react',
    hostInfo?.version ?? '1.0.0',
  ]);

  return (
    <MCPAppFrameSession
      key={sessionKey}
      {...props}
      sandboxUrl={sandboxUrl}
      targetOrigin={targetOrigin}
      resourceCSP={resourceCSP}
      resourceAllow={resourceAllow}
      innerSandbox={innerSandbox}
      outerSandbox={outerSandbox}
    />
  );
}

function MCPAppFrameSession({
  app,
  resource,
  input,
  output,
  sandbox,
  handlers,
  hostInfo,
  hostContext,
  sandboxUrl,
  targetOrigin,
  resourceCSP,
  resourceAllow,
  innerSandbox,
  outerSandbox,
}: MCPAppFrameProps & {
  sandboxUrl: string;
  targetOrigin?: string;
  resourceCSP: string;
  resourceAllow?: string;
  innerSandbox: string;
  outerSandbox: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<MCPAppBridge | undefined>(undefined);
  const hostInfoRef = useRef(hostInfo);
  const inputRef = useRef(input);
  const outputRef = useRef(output);
  const hostContextRef = useRef(hostContext);
  const initializedRef = useRef(false);
  inputRef.current = input;
  outputRef.current = output;
  hostContextRef.current = hostContext;
  const bridgeHandlers = useMemo(
    () => ({
      ...handlers,
      onInitialized: () => {
        initializedRef.current = true;
        handlers?.onInitialized?.();
        sendToolState({
          bridge: bridgeRef.current,
          input: inputRef.current,
          output: outputRef.current,
        });
      },
    }),
    [handlers],
  );
  const bridgeHandlersRef = useRef(bridgeHandlers);
  bridgeHandlersRef.current = bridgeHandlers;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe == null || targetOrigin == null) {
      return;
    }

    initializedRef.current = false;
    let bridge: MCPAppBridge | undefined;

    const onMessage = (event: MessageEvent) => {
      // Only handle messages from the proxy window and expected origin.
      if (bridge == null || !bridge.acceptsEvent(event)) {
        return;
      }

      if (
        event.data?.jsonrpc === '2.0' &&
        event.data.method === 'ui/notifications/sandbox-proxy-ready'
      ) {
        bridge.sendSandboxResourceReady({
          html: resource.html,
          csp: resourceCSP,
          sandbox: innerSandbox,
          allow: resourceAllow,
        });
        return;
      }

      bridge.handleMessage(event);
    };

    window.addEventListener('message', onMessage);
    // Navigate only after the listener is installed. A cached proxy can post
    // its ready notification as soon as its document starts executing.
    iframe.src = sandboxUrl;
    const targetWindow = iframe.contentWindow;
    if (targetWindow == null) {
      window.removeEventListener('message', onMessage);
      return;
    }

    bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: bridgeHandlersRef.current,
      hostInfo: hostInfoRef.current,
      hostContext: hostContextRef.current,
    });
    bridgeRef.current = bridge;

    return () => {
      initializedRef.current = false;
      window.removeEventListener('message', onMessage);
      try {
        void bridge.teardownResource().catch(() => {});
      } catch {
        // The browser may have already detached the browsing context.
      }
      bridge.close();
      bridgeRef.current = undefined;
      // Revoke the old browsing context immediately while React removes it.
      iframe.src = 'about:blank';
    };
  }, [
    innerSandbox,
    resource.html,
    resourceAllow,
    resourceCSP,
    sandboxUrl,
    targetOrigin,
  ]);

  useEffect(() => {
    bridgeRef.current?.setHandlers(bridgeHandlers);
  }, [bridgeHandlers]);

  useEffect(() => {
    if (hostContext != null) {
      bridgeRef.current?.setHostContext(hostContext);
    }
  }, [hostContext]);

  useEffect(() => {
    if (initializedRef.current && input !== undefined) {
      bridgeRef.current?.sendToolInput(input);
    }
  }, [input]);

  useEffect(() => {
    if (initializedRef.current && output !== undefined) {
      bridgeRef.current?.sendToolResult(normalizeMCPAppToolResult(output));
    }
  }, [output]);

  return (
    <iframe
      ref={iframeRef}
      title="MCP App"
      aria-label={sandbox.title ?? app.resourceUri}
      className={sandbox.className}
      style={sandbox.style}
      sandbox={outerSandbox}
    />
  );
}
