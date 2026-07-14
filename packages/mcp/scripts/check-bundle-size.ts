import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const RAW_LIMIT = 5 * 1024;
const GZIP_LIMIT = 2 * 1024;

const result = await build({
  stdin: {
    contents: `
      import { mcpAppClientCapabilities } from './src/index.ts';
      console.log(mcpAppClientCapabilities);
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  minify: true,
  platform: 'browser',
  treeShaking: true,
  write: false,
});

const bytes = result.outputFiles[0].contents;
const rawSize = bytes.byteLength;
const gzipSize = gzipSync(bytes, { level: 9 }).byteLength;

console.log(`MCP Apps lightweight import: ${rawSize} B (${gzipSize} B gzip)`);

if (rawSize > RAW_LIMIT || gzipSize > GZIP_LIMIT) {
  throw new Error(
    `MCP Apps lightweight import exceeds its ${RAW_LIMIT} B raw / ${GZIP_LIMIT} B gzip budget`,
  );
}
