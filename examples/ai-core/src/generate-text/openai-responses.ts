<<<<<<< HEAD:examples/ai-core/src/generate-text/openai-responses.ts
import { type OpenAIResponsesProviderOptions, openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import 'dotenv/config';

async function main() {
=======
import { openai } from '@ai-sdk/openai';
import { generateText, isStepCount } from 'ai';
import fs from 'node:fs';
import { run } from '../../lib/run';

run(async () => {
  const screenshot = fs
    .readFileSync('./data/screenshot-editor.png')
    .toString('base64');

>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290)):examples/ai-functions/src/generate-text/openai/responses.ts
  const result = await generateText({
    model: openai.responses('gpt-5.4'),
    tools: {
      computer: openai.tools.computer({
        needsApproval: ({ pendingSafetyChecks }) =>
          pendingSafetyChecks.length > 0,
        execute: async ({ actions, pendingSafetyChecks }) => {
          // Replace this logging with an isolated browser or VM harness that
          // executes every action in order.
          for (const action of actions) {
            console.log('Computer action:', action);
          }

          return {
            output: {
              type: 'computer_screenshot',
              imageUrl: `data:image/png;base64,${screenshot}`,
              detail: 'original',
            },
            acknowledgedSafetyChecks: pendingSafetyChecks,
          };
        },
<<<<<<< HEAD:examples/ai-core/src/generate-text/openai-responses.ts
        user: 'user_123',
      } satisfies OpenAIResponsesProviderOptions,
=======
      }),
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290)):examples/ai-functions/src/generate-text/openai/responses.ts
    },
    prompt:
      'Inspect the current screen and describe the editor. Do not change anything.',
    stopWhen: isStepCount(3),
  });

  console.log(result.text);
  console.log('Finish reason:', result.finishReason);
<<<<<<< HEAD:examples/ai-core/src/generate-text/openai-responses.ts
  console.log('Usage:', result.usage);

  console.log('Request:', JSON.stringify(result.request, null, 2));
  console.log('Response:', JSON.stringify(result.response, null, 2));
}

main().catch(console.error);
=======
  console.log('Tool calls:', JSON.stringify(result.toolCalls, null, 2));
});
>>>>>>> 0063c2d35 (feat: add OpenAI Responses API computer tool support (#17290)):examples/ai-functions/src/generate-text/openai/responses.ts
