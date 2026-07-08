import { createGoogle } from '@ai-sdk/google';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';

async function main() {
  const requestBodies: unknown[] = [];
  const pdfBase64 = Buffer.from(
    '%PDF-1.7\n% issue 16072 minimal PDF payload\n%%EOF\n',
  ).toString('base64');

  const google = createGoogle({
    fetch: async (url, init) => {
      if (init?.body != null) {
        requestBodies.push(JSON.parse(String(init.body)));
      }

      return fetch(url, init);
    },
  });

  await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: 'Call the catalogSearch tool once.',
    tools: {
      catalogSearch: tool({
        description: 'Return catalog PDF metadata and file.',
        inputSchema: z.object({}),
        execute: async () => ({ pdfBase64 }),
        toModelOutput: ({ output }) => ({
          type: 'content',
          value: [
            { type: 'text', text: 'metadata' },
            {
              type: 'file',
              mediaType: 'application/pdf',
              filename: 'catalog.pdf',
              data: { type: 'data', data: output.pdfBase64 },
            },
          ],
        }),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'catalogSearch' },
    stopWhen: isStepCount(2),
    maxOutputTokens: 16,
  });

  const toolResultRequest = requestBodies[1] as
    | {
        contents?: Array<{ parts?: Array<Record<string, unknown>> }>;
      }
    | undefined;
  const allParts =
    toolResultRequest?.contents?.flatMap(content => content.parts ?? []) ?? [];
  const textPartWithPdf = allParts.find(
    part => typeof part.text === 'string' && part.text.includes(pdfBase64),
  );

  console.log(
    JSON.stringify(
      {
        requestCount: requestBodies.length,
        reproduced: textPartWithPdf != null,
        observedTextPartPreview:
          typeof textPartWithPdf?.text === 'string'
            ? textPartWithPdf.text.slice(0, 180)
            : undefined,
      },
      null,
      2,
    ),
  );

  if (textPartWithPdf == null) {
    throw new Error(
      'Issue #16072 was not reproduced: no text part contained the PDF base64.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
