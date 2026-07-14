import type { MCPAppResourceCSP } from '@ai-sdk/mcp';

// CSP source values come from the (untrusted) MCP server. Rather than
// denylisting bad characters on the raw string (which an encoding like "%3B"
// can slip past), canonicalize each value: parse it as an absolute URL so any
// percent-encoding is decoded, keep only https/wss origins, then re-check the
// decoded origin so a separator that decoded back into ";" "," or whitespace
// cannot split the directive.
const ALLOWED_CSP_SCHEMES = new Set(['https:', 'wss:']);

function sanitizeCSPSources(sources?: string[]): string[] {
  const result: string[] = [];
  for (const source of sources ?? []) {
    if (typeof source !== 'string') {
      continue;
    }

    let origin: string;
    try {
      const url = new URL(source);
      // Reject non-https/wss, the empty host, and a bare "*" host (which would
      // match every origin and defeat the allowlist, like scheme-only "https:").
      if (
        !ALLOWED_CSP_SCHEMES.has(url.protocol) ||
        url.host.length === 0 ||
        url.host === '*'
      ) {
        continue;
      }
      origin = url.origin;
    } catch {
      continue;
    }

    // Drop separators that split the directive and quotes that could break out
    // of an HTML attribute the policy may be embedded in downstream.
    if (/["'`\s;,]/.test(origin)) {
      continue;
    }

    result.push(origin);
  }
  return result;
}

/**
 * Default sandbox permissions for the outer sandbox proxy iframe.
 */
export const MCP_APP_DEFAULT_OUTER_SANDBOX =
  'allow-scripts allow-same-origin allow-forms';

/**
 * Default sandbox permissions for the inner iframe that runs app HTML.
 */
export const MCP_APP_DEFAULT_INNER_SANDBOX = 'allow-scripts allow-forms';

/**
 * Converts MCP App CSP metadata into a Content-Security-Policy string.
 *
 * The returned value is meant to be passed to a sandbox proxy, which can apply
 * it to the inner iframe document.
 *
 * @example
 * ```ts
 * const csp = getMCPAppCSP({
 *   connectDomains: ['https://api.example.com'],
 *   resourceDomains: ['https://cdn.example.com'],
 * });
 * ```
 */
export function getMCPAppCSP(csp?: MCPAppResourceCSP): string {
  const connectDomains = sanitizeCSPSources(csp?.connectDomains);
  const connectSrc = connectDomains.length === 0 ? ["'none'"] : connectDomains;
  const imgSrc = [
    "'self'",
    'data:',
    ...sanitizeCSPSources(csp?.resourceDomains),
  ];
  const frameDomains = sanitizeCSPSources(csp?.frameDomains);
  const frameSrc = frameDomains.length === 0 ? ["'none'"] : frameDomains;

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    // MCP Apps commonly ship inline scripts and styles. They remain contained
    // by the inner iframe's opaque-origin sandbox and the restrictive policy.
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${connectSrc.join(' ')}`,
    `img-src ${imgSrc.join(' ')}`,
    `font-src ${imgSrc.join(' ')}`,
    `media-src ${imgSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
  ].join('; ');
}

/**
 * A permission an MCP App may request and a host may allow.
 */
export type MCPAppPermission =
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'clipboardWrite';

export type MCPAppGrantedPermissions = Partial<
  Record<MCPAppPermission, Record<string, never>>
>;

const MCP_APP_PERMISSION_FEATURES: Record<MCPAppPermission, string> = {
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'geolocation',
  clipboardWrite: 'clipboard-write',
};

function isPermissionRequest(value: unknown): value is object {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns the permissions that are both validly requested by the resource and
 * explicitly allowed by the host.
 */
export function getGrantedMCPAppPermissions(
  permissions?: Record<string, unknown>,
  allowedPermissions?: MCPAppPermission[],
): MCPAppGrantedPermissions {
  const granted: MCPAppGrantedPermissions = {};
  if (
    permissions == null ||
    typeof permissions !== 'object' ||
    Array.isArray(permissions) ||
    allowedPermissions == null
  ) {
    return granted;
  }

  const allowed = new Set(allowedPermissions);
  for (const permission of Object.keys(
    MCP_APP_PERMISSION_FEATURES,
  ) as MCPAppPermission[]) {
    if (
      allowed.has(permission) &&
      isPermissionRequest(permissions[permission])
    ) {
      granted[permission] = {};
    }
  }

  return granted;
}

/**
 * Converts MCP App permission metadata into an iframe `allow` attribute.
 *
 * Deny-by-default: a capability is granted only when it is both requested in
 * `permissions` and present in the host `allowedPermissions` allowlist.
 * Omitting the allowlist grants nothing, mirroring `allowedTools` in the bridge.
 *
 * @example
 * ```ts
 * const allow = getMCPAppAllowAttribute(
 *   { microphone: {}, camera: {} },
 *   ['microphone'],
 * );
 * // "microphone" — camera requested by server but not host-allowed
 * ```
 */
export function getMCPAppAllowAttribute(
  permissions?: Record<string, unknown>,
  allowedPermissions?: MCPAppPermission[],
): string | undefined {
  const granted = getGrantedMCPAppPermissions(permissions, allowedPermissions);
  const allow = (Object.keys(granted) as MCPAppPermission[]).map(
    permission => MCP_APP_PERMISSION_FEATURES[permission],
  );

  return allow.length > 0 ? allow.join('; ') : undefined;
}
