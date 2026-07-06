import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from '@ai-sdk/openai';
import { APICallError, isStepCount, streamText, tool } from 'ai';
import { z } from 'zod';

const encryptedContentVerificationError =
  /encrypted content.*could not be verified/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function main() {
  const rawChunksByStep: string[][] = [];
  let stepCount = 0;
  let toolResultCount = 0;
  let text = '';

  const result = streamText({
    model: openai.responses('gpt-5.2'),
    stopWhen: isStepCount(3),
    maxOutputTokens: 1200,
    reasoning: 'low',
    providerOptions: {
      openai: {
        store: false,
        reasoningSummary: 'auto',
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    include: {
      rawChunks: true,
    },
    tools: {
      lookupVerificationCode: tool({
        description:
          'Look up the short verification code that must be included in the final answer.',
        inputSchema: z.object({
          label: z.string(),
        }),
        execute: async ({ label }) => ({
          label,
          code: 'blue-42',
        }),
      }),
    },
    prompt:
      'Use the lookupVerificationCode tool exactly once with label "issue-11239". ' +
      'After the tool result is returned, answer in one sentence and include the code.',
  });

  for await (const chunk of result.fullStream) {
    if (chunk.type === 'start-step') {
      stepCount++;
      rawChunksByStep.push([]);
      console.log(`start-step ${stepCount}`);
    } else if (chunk.type === 'raw') {
      if (rawChunksByStep.length === 0) {
        rawChunksByStep.push([]);
      }
      rawChunksByStep.at(-1)!.push(JSON.stringify(chunk.rawValue));
    } else if (chunk.type === 'tool-result') {
      toolResultCount++;
      console.log(`tool-result ${chunk.toolName}:`, chunk.output);
    } else if (chunk.type === 'text-delta') {
      text += chunk.text;
    } else if (chunk.type === 'error') {
      const message = errorMessage(chunk.error);
      if (encryptedContentVerificationError.test(message)) {
        throw new Error(
          `Reproduced issue #11239: OpenAI rejected encrypted reasoning content between steps: ${message}`,
          { cause: chunk.error },
        );
      }
      throw chunk.error;
    }
  }

  const outputDir = path.join('output');
  fs.mkdirSync(outputDir, { recursive: true });
  rawChunksByStep.forEach((chunks, index) => {
    fs.writeFileSync(
      path.join(outputDir, `issue-11239.${index + 1}.chunks.txt`),
      chunks.join('\n'),
    );
  });

  if (stepCount < 2 || toolResultCount < 1) {
    throw new Error(
      `Harness did not exercise a multi-step tool round trip (steps=${stepCount}, toolResults=${toolResultCount}).`,
    );
  }

  if (encryptedContentVerificationError.test(text)) {
    throw new Error(
      `Reproduced issue #11239: model text contained encrypted content verification error: ${text}`,
    );
  }

  console.log('completed without encrypted content verification error');
  console.log(`steps=${stepCount}; toolResults=${toolResultCount}`);
  console.log(`text=${text.trim()}`);
}

main().catch(error => {
  console.error(error);

  if (APICallError.isInstance(error)) {
    console.error('statusCode:', error.statusCode);
    console.error('requestBodyValues:', error.requestBodyValues);
    console.error('responseBody:', error.responseBody);

    if (
      encryptedContentVerificationError.test(error.message) ||
      encryptedContentVerificationError.test(String(error.responseBody))
    ) {
      process.exit(112);
    }
  }

  process.exit(1);
});
