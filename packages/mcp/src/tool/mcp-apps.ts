import { isJSONObject, type JSONObject } from '@ai-sdk/provider';
import { convertBase64ToUint8Array } from '@ai-sdk/provider-utils';
import type { MCPClient } from './mcp-client';
import type {
  ClientCapabilities,
  ListToolsResult,
  ReadResourceResult,
  RequestOptions,
  ToolMeta,
} from './types';

/**
 * MCP capability extension name used by hosts that can render MCP Apps.
 */
export const MCP_APP_EXTENSION_NAME = 'io.modelcontextprotocol/ui' as const;

/**
 * MIME type for HTML resources that are meant to be rendered as MCP Apps.
 */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app' as const;

/**
 * Deprecated flat metadata key for app resource URIs.
 * Hosts still check it for compatibility with older MCP Apps servers.
 */
export const MCP_APP_LEGACY_RESOURCE_URI_META_KEY = 'ui/resourceUri' as const;

/**
 * Client capabilities to pass to `createMCPClient` when the host supports MCP Apps.
 */
export const mcpAppClientCapabilities = {
  extensions: {
    [MCP_APP_EXTENSION_NAME]: {
      mimeTypes: [MCP_APP_MIME_TYPE],
    },
  },
} as const satisfies ClientCapabilities;

export type MCPAppToolVisibility = 'model' | 'app';

/**
 * Normalized `_meta.ui` metadata from an MCP tool definition.
 */
export type MCPAppToolMeta = {
  resourceUri?: string;
  visibility?: MCPAppToolVisibility[];
  [key: string]: unknown;
};

/**
 * Content security policy metadata requested by an MCP App resource.
 */
export type MCPAppResourceCSP = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  [key: string]: unknown;
};

/**
 * Browser capabilities requested by an MCP App resource.
 */
export type MCPAppResourcePermissions = {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
  [key: string]: unknown;
};

/**
 * Host rendering metadata from an MCP App resource.
 */
export type MCPAppResourceMeta = {
  prefersBorder?: boolean;
  csp?: MCPAppResourceCSP;
  permissions?: MCPAppResourcePermissions;
  [key: string]: unknown;
};

/**
 * HTML and metadata needed by a host to render an MCP App.
 */
export type MCPAppResource = {
  uri: string;
  mimeType: typeof MCP_APP_MIME_TYPE;
  html: string;
  meta?: MCPAppResourceMeta;
};

type MCPAppToolLike = {
  _meta?: ToolMeta;
  [key: string]: unknown;
};

function getToolUiMeta(meta?: ToolMeta): JSONObject | undefined {
  const uiMeta = meta?.ui;
  return isRecord(uiMeta) ? uiMeta : undefined;
}

function isRecord(value: unknown): value is JSONObject {
  return isJSONObject(value) && !Array.isArray(value);
}

function hasOwn(record: JSONObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const CSP_DOMAIN_KEYS = [
  'connectDomains',
  'resourceDomains',
  'frameDomains',
] as const;

function parseResourceCSP(value: unknown): MCPAppResourceCSP | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: MCPAppResourceCSP = { ...value };
  for (const key of CSP_DOMAIN_KEYS) {
    if (hasOwn(value, key)) {
      const domains = value[key];
      result[key] = Array.isArray(domains)
        ? domains.filter(
            (domain): domain is string => typeof domain === 'string',
          )
        : undefined;
    }
  }
  return result;
}

const PERMISSION_KEYS = [
  'camera',
  'microphone',
  'geolocation',
  'clipboardWrite',
] as const;

function parseResourcePermissions(
  value: unknown,
): MCPAppResourcePermissions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: MCPAppResourcePermissions = { ...value };
  for (const key of PERMISSION_KEYS) {
    if (hasOwn(value, key)) {
      // Permission markers are empty objects in the protocol. Normalize valid
      // objects and reject scalar/array lookalikes without dropping future keys.
      result[key] = isRecord(value[key]) ? {} : undefined;
    }
  }
  return result;
}

/**
 * Runtime parser for `_meta.ui` on an MCP App resource. Each known field is
 * validated independently, malformed fields are dropped rather than failing
 * the whole resource, and unknown keys pass through for forward compatibility.
 * This stays dependency-free because the helpers are on a common import path.
 */
function getResourceUiMeta(meta: unknown): MCPAppResourceMeta | undefined {
  const resourceMeta = isRecord(meta) ? meta : undefined;
  const rawUiMeta = resourceMeta?.ui;
  if (!isRecord(rawUiMeta)) {
    return undefined;
  }

  const result: MCPAppResourceMeta = { ...rawUiMeta };
  if (hasOwn(rawUiMeta, 'prefersBorder')) {
    result.prefersBorder =
      typeof rawUiMeta.prefersBorder === 'boolean'
        ? rawUiMeta.prefersBorder
        : undefined;
  }
  if (hasOwn(rawUiMeta, 'csp')) {
    result.csp = parseResourceCSP(rawUiMeta.csp);
  }
  if (hasOwn(rawUiMeta, 'permissions')) {
    result.permissions = parseResourcePermissions(rawUiMeta.permissions);
  }
  return result;
}

function parseVisibility(value: unknown): MCPAppToolVisibility[] | undefined {
  return Array.isArray(value)
    ? value.filter(
        (v): v is MCPAppToolVisibility => v === 'model' || v === 'app',
      )
    : undefined;
}

/**
 * Reads and validates MCP Apps metadata from a tool definition.
 */
export function getMCPAppToolMeta(
  tool: MCPAppToolLike,
): MCPAppToolMeta | undefined {
  const uiMeta = getToolUiMeta(tool._meta);
  const resourceUri =
    uiMeta?.resourceUri ?? tool._meta?.[MCP_APP_LEGACY_RESOURCE_URI_META_KEY];
  const visibility = parseVisibility(uiMeta?.visibility);

  if (resourceUri !== undefined) {
    if (typeof resourceUri !== 'string' || !resourceUri.startsWith('ui://')) {
      throw new Error(
        `Invalid MCP App resource URI: ${JSON.stringify(resourceUri)}`,
      );
    }
  } else if (uiMeta == null) {
    return undefined;
  }

  return {
    ...uiMeta,
    ...(resourceUri != null ? { resourceUri } : {}),
    ...(visibility != null ? { visibility } : {}),
  };
}

/**
 * Returns the `ui://` app resource URI attached to a tool, if present.
 */
export function getMCPAppResourceUri(tool: MCPAppToolLike): string | undefined {
  return getMCPAppToolMeta(tool)?.resourceUri;
}

/**
 * Checks whether a tool has an MCP App resource attached.
 */
export function isMCPAppTool(tool: MCPAppToolLike): boolean {
  return getMCPAppResourceUri(tool) != null;
}

/**
 * Splits tool definitions into model-visible tools and app-visible tools.
 */
export function splitMCPAppTools(definitions: ListToolsResult): {
  modelVisible: ListToolsResult;
  appVisible: ListToolsResult;
} {
  const modelVisibleTools = [];
  const appVisibleTools = [];

  for (const tool of definitions.tools) {
    const visibility = getMCPAppToolMeta(tool)?.visibility;

    // Tools without app visibility metadata remain model-visible.
    if (visibility == null || visibility.includes('model')) {
      modelVisibleTools.push(tool);
    }

    if (visibility?.includes('app') === true) {
      appVisibleTools.push(tool);
    }
  }

  return {
    modelVisible: {
      ...definitions,
      tools: modelVisibleTools,
    },
    appVisible: {
      ...definitions,
      tools: appVisibleTools,
    },
  };
}

/**
 * Returns the unique MCP App resource URIs referenced by tool definitions.
 */
export function getMCPAppResourceUris(definitions: ListToolsResult): string[] {
  return [
    ...new Set(
      definitions.tools
        .map(tool => getMCPAppResourceUri(tool))
        .filter((uri): uri is string => uri != null),
    ),
  ];
}

/**
 * Extracts app HTML and rendering metadata from a `resources/read` result.
 */
export function getMCPAppResourceFromReadResult({
  uri,
  resource,
}: {
  uri: string;
  resource: ReadResourceResult;
}): MCPAppResource {
  const content = resource.contents.find(content => content.uri === uri);

  if (content == null) {
    throw new Error(`MCP App resource not found in read result: ${uri}`);
  }

  if (content.mimeType !== MCP_APP_MIME_TYPE) {
    throw new Error(
      `Unsupported MCP App resource MIME type: ${content.mimeType}`,
    );
  }

  const html =
    'text' in content && typeof content.text === 'string'
      ? content.text
      : 'blob' in content && typeof content.blob === 'string'
        ? new TextDecoder().decode(convertBase64ToUint8Array(content.blob))
        : undefined;

  if (html == null) {
    throw new Error(`Unsupported MCP App resource content format: ${uri}`);
  }

  const meta = getResourceUiMeta(content._meta);

  return { uri, mimeType: MCP_APP_MIME_TYPE, html, meta };
}

/**
 * Reads a `ui://` resource from an MCP server and normalizes it for rendering.
 */
export async function readMCPAppResource({
  client,
  uri,
  options,
}: {
  client: Pick<MCPClient, 'readResource'>;
  uri: string;
  options?: RequestOptions;
}): Promise<MCPAppResource> {
  if (!uri.startsWith('ui://')) {
    throw new Error(`Unsupported MCP App resource URI: ${uri}`);
  }

  return getMCPAppResourceFromReadResult({
    uri,
    resource: await client.readResource({ uri, options }),
  });
}
