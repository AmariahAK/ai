import { generateText, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const Task = z.object({
  id: z.number().optional(),
  description: z.string(),
  type: z.enum(['feature', 'bug']),
  passes: z.boolean(),
});

const WebsiteUpdateInput = z.object({
  tasks: z.array(Task),
  assets: z.array(z.string()).optional(),
  website_path: z.string(),
});

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 20,
    text: 20,
    reasoning: undefined,
  },
};

async function main() {
  const validObject = {
    website_path: '/home/user/pace-landing',
    tasks: [
      {
        description:
          'Today Strava does not answer the question: "What should I do next after this run?".',
        type: 'feature' as const,
        passes: false,
      },
    ],
    assets: ['/home/user/Videos/clip_6.mp4'],
  };

  // The schema accepts the value when it is already an object.
  WebsiteUpdateInput.parse(validObject);

  // This mirrors the raw tool input from issue #11719 after the outer logging
  // JSON string is decoded: the quote characters inside the description are
  // not escaped for the tool-call JSON string, so the SDK JSON parser rejects
  // the entire tool input before the zod schema can validate it.
  const rawToolInputFromLlm = `{
    "website_path": "/home/user/pace-landing",
    "tasks": [
      {
        "description": "Today Strava does not answer the question: "What should I do next after this run?".",
        "type": "feature",
        "passes": false
      }
    ],
    "assets": ["/home/user/Videos/clip_6.mp4"]
  }`;

  const result = await generateText({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        warnings: [],
        usage,
        finishReason: { unified: 'tool-calls', raw: undefined },
        content: [
          {
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: 'call-issue-11719',
            toolName: 'website_update',
            input: rawToolInputFromLlm,
          },
        ],
      }),
    }),
    tools: {
      website_update: tool({
        description: 'Update a generated website.',
        inputSchema: WebsiteUpdateInput,
        execute: async input => ({
          ok: true,
          taskCount: input.tasks.length,
        }),
      }),
    },
    prompt:
      'Create website update tasks; one description includes a double-quoted question.',
  });

  const toolError = result.content.find(part => part.type === 'tool-error');

  console.log(
    JSON.stringify(
      result.content.map(part =>
        part.type === 'tool-error'
          ? {
              type: part.type,
              toolName: part.toolName,
              error: part.error,
            }
          : { type: part.type },
      ),
      null,
      2,
    ),
  );

  if (toolError != null) {
    throw new Error(
      `Reproduced issue #11719: tool input with a double-quoted question was rejected instead of parsed/executed: ${toolError.error}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
