import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { NoSuchToolError } from 'ai';

import { validateToolCall } from '../../../../packages/harness/src/agent/internal/run-prompt.ts';

// Reproduction for vercel/ai#16694: Claude Code's native ToolSearch
// provider-executed tool is not declared in createClaudeCode().builtinTools.
async function main() {
  const harness = createClaudeCode();
  const builtinToolNames = Object.keys(harness.builtinTools);

  console.log('Claude Code builtin tools:', builtinToolNames.join(', '));
  console.log('Includes ToolSearch:', builtinToolNames.includes('ToolSearch'));

  const result = await validateToolCall({
    event: {
      type: 'tool-call',
      toolCallId: 'toolu_16694_toolsearch',
      toolName: 'ToolSearch',
      nativeName: 'ToolSearch',
      providerExecuted: true,
      input:
        '{"query":"select:mcp__harness-tools__ask_user_question","max_results":1}',
    },
    tools: harness.builtinTools,
  });

  const error = (result as { error?: unknown }).error;
  console.log(
    'Validated ToolSearch result:',
    JSON.stringify(
      {
        type: result.type,
        toolName: (result as { toolName?: string }).toolName,
        dynamic: (result as { dynamic?: boolean }).dynamic,
        invalid: (result as { invalid?: boolean }).invalid,
        providerExecuted: (result as { providerExecuted?: boolean })
          .providerExecuted,
        errorName: error instanceof Error ? error.name : undefined,
        isNoSuchToolError: NoSuchToolError.isInstance(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );

  if (
    (result as { invalid?: boolean }).invalid === true &&
    NoSuchToolError.isInstance(error)
  ) {
    throw new Error(
      'Reproduced #16694: provider-executed ToolSearch was marked invalid with NoSuchToolError. Expected ToolSearch to be declared as a Claude Code builtin or treated as a non-invalid dynamic provider-executed tool call.',
    );
  }

  if (!builtinToolNames.includes('ToolSearch')) {
    throw new Error(
      'Reproduced #16694: ToolSearch is missing from createClaudeCode().builtinTools, but validation did not return NoSuchToolError.',
    );
  }

  console.log(
    'ToolSearch was accepted; this worktree does not reproduce issue #16694.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
