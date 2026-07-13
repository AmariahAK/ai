import { anthropic } from '@ai-sdk/anthropic';
import { tool, type ModelMessage } from 'ai';
import { z } from 'zod/v4';
import { WorkflowAgent } from '../../../../packages/workflow/dist/index.js';

const narration = 'ISSUE-17123-NARRATION';

async function main() {
  let secondStepMessages: ModelMessage[] | undefined;

  const agent = new WorkflowAgent({
    model: anthropic('claude-haiku-4-5'),
    tools: {
      applyFix: tool({
        description: 'Apply the selected fix.',
        inputSchema: z.object({}),
        execute: async () => ({ applied: true }),
      }),
    },
    prepareStep: ({ stepNumber, messages }) => {
      if (stepNumber === 1) {
        secondStepMessages = messages as ModelMessage[];
        return { toolChoice: 'none' };
      }
      return {};
    },
  });

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: `Write exactly "${narration}" as visible text, then call the applyFix tool in the same response. Do not write any other text before the tool call.`,
      },
    ],
    writable: new WritableStream(),
  });

  const firstStep = result.steps[0];
  const priorAssistantMessage = secondStepMessages?.find(
    message => message.role === 'assistant',
  );
  const priorAssistantContent = Array.isArray(priorAssistantMessage?.content)
    ? priorAssistantMessage.content
    : [];
  const narrationWasGenerated = firstStep?.content.some(
    part => part.type === 'text' && part.text === narration,
  );
  const narrationWasCarriedForward = priorAssistantContent.some(
    part => part.type === 'text' && part.text === narration,
  );

  console.log(
    JSON.stringify(
      {
        firstStepFinishReason: firstStep?.finishReason,
        firstStepContent: firstStep?.content,
        secondStepAssistantContent: priorAssistantContent,
        narrationWasGenerated,
        narrationWasCarriedForward,
      },
      null,
      2,
    ),
  );

  if (!narrationWasGenerated) {
    throw new Error(
      'The live model did not generate the expected narration before the tool call.',
    );
  }

  if (!narrationWasCarriedForward) {
    throw new Error(
      'Reproduced issue #17123: WorkflowAgent dropped assistant text from the prompt after a tool-calls finish.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
