import { createAlibaba } from '@ai-sdk/alibaba';
import { experimental_generateVideo as generateVideo } from 'ai';

type CapturedFetch = {
  url: string;
  method: string;
  requestBody?: unknown;
  response?: {
    status: number;
    body?: unknown;
  };
};

async function parseJsonOrText(text: string): Promise<unknown> {
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function main() {
  const calls: CapturedFetch[] = [];

  const model = createAlibaba({
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      const requestText =
        typeof init?.body === 'string'
          ? init.body
          : init?.body == null
            ? undefined
            : String(init.body);

      const call: CapturedFetch = {
        url,
        method,
        requestBody:
          requestText == null ? undefined : await parseJsonOrText(requestText),
      };
      calls.push(call);

      const response = await fetch(input, init);
      const responseText = await response.clone().text();
      call.response = {
        status: response.status,
        body: await parseJsonOrText(responseText),
      };
      return response;
    },
  }).video('wan2.7-t2v');

  try {
    const result = await generateVideo({
      model,
      prompt: 'A serene mountain lake at sunset',
      resolution: '1024x768',
      providerOptions: {
        alibaba: {
          pollIntervalMs: 250,
          pollTimeoutMs: 1500,
        },
      },
    });

    console.log(
      JSON.stringify(
        {
          outcome: 'resolved',
          warnings: result.warnings,
          calls,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          outcome: 'rejected',
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  cause: error.cause,
                }
              : error,
          calls,
        },
        null,
        2,
      ),
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
