import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs } from 'ai';
import 'dotenv/config';
import fs from 'node:fs';

async function main() {
  const screenshot = fs
    .readFileSync('./data/screenshot-editor.png')
    .toString('base64');

  const result = await generateText({
    model: openai.responses('gpt-5.4'),
    tools: {
      computer: openai.tools.computer({
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
      }),
    },
    prompt:
      'Inspect the current screen and describe the editor. Do not change anything.',
    stopWhen: stepCountIs(3),
  });

  console.log(result.text);
  console.log('Finish reason:', result.finishReason);
  console.log('Usage:', result.usage);
  console.log('Tool calls:', JSON.stringify(result.toolCalls, null, 2));
}

main().catch(console.error);
