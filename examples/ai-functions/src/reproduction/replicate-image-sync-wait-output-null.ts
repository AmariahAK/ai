import { createReplicate } from '@ai-sdk/replicate';
import { APICallError, generateImage } from 'ai';

const initialPrediction = {
  id: 'sync-wait-starting-output-null',
  model: 'black-forest-labs/flux-dev',
  version: 'test-version',
  input: {
    prompt: 'A watercolor landscape at twilight',
  },
  logs: '',
  output: null,
  data_removed: false,
  error: null,
  status: 'starting',
  created_at: '2026-07-09T00:00:00.000Z',
  urls: {
    cancel:
      'https://api.replicate.com/v1/predictions/sync-wait-starting-output-null/cancel',
    get: 'https://api.replicate.com/v1/predictions/sync-wait-starting-output-null',
  },
};

const succeededPrediction = {
  ...initialPrediction,
  output: ['https://replicate.delivery/test/out-0.webp'],
  status: 'succeeded',
  completed_at: '2026-07-09T00:00:05.000Z',
  metrics: {
    predict_time: 5,
  },
};

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

async function main() {
  const requests: Array<{ method: string; url: string }> = [];

  const replicate = createReplicate({
    apiToken: 'test-api-token',
    fetch: async (url, init) => {
      const urlString = url.toString();
      const method = init?.method ?? 'GET';

      requests.push({ method, url: urlString });

      if (
        method === 'POST' &&
        urlString ===
          'https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions'
      ) {
        return new Response(JSON.stringify(initialPrediction), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && urlString === initialPrediction.urls.get) {
        return new Response(JSON.stringify(succeededPrediction), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        method === 'GET' &&
        urlString === 'https://replicate.delivery/test/out-0.webp'
      ) {
        return new Response(new Uint8Array(Buffer.from('test-image-binary')), {
          status: 200,
          headers: { 'Content-Type': 'image/webp' },
        });
      }

      throw new Error(`Unexpected request: ${method} ${urlString}`);
    },
  });

  try {
    const result = await generateImage({
      model: replicate.image('black-forest-labs/flux-dev'),
      prompt: 'A watercolor landscape at twilight',
      size: '1024x1024',
    });

    if (requests.some(request => request.url === initialPrediction.urls.get)) {
      console.log(
        `Replicate image generation polled ${initialPrediction.urls.get} and returned ${result.images.length} image(s).`,
      );
      return;
    }

    throw new Error(
      `Expected the image model to poll ${initialPrediction.urls.get}, but it did not. Requests: ${JSON.stringify(
        requests,
      )}`,
    );
  } catch (error) {
    console.error('Expected generateImage to poll the prediction and succeed.');
    console.error('Observed rejection:', {
      name: getErrorName(error),
      message: getErrorMessage(error),
      isAPICallError: APICallError.isInstance(error),
      statusCode: APICallError.isInstance(error) ? error.statusCode : undefined,
      causeName: APICallError.isInstance(error)
        ? getErrorName(error.cause)
        : undefined,
      causeMessage: APICallError.isInstance(error)
        ? getErrorMessage(error.cause)
        : undefined,
      requests,
    });
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
