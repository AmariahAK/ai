#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "Reproducing vercel/ai#13438: Provider requires rerankingModel but OpenResponsesProvider inherits optional ProviderV3.rerankingModel"
echo "Command: pnpm exec tsc -p reproductions/issue-13438/tsconfig.json"
pnpm exec tsc -p reproductions/issue-13438/tsconfig.json
