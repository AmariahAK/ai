import { createXai } from '@ai-sdk/xai';

const baseURL = 'https://xai.example.test/v1';
const completedVideoUrl = 'https://vidgen.x.ai/example/completed.mp4';

function createPollingFetch() {
  let pollCount = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (init?.method === 'POST') {
      return Response.json({ request_id: 'request-123' });
    }

    if (url === `${baseURL}/videos/request-123`) {
      pollCount++;

      if (pollCount === 1) {
        return new Response(null, { status: 202 });
      }

      return Response.json({
        status: 'done',
        video: {
          url: completedVideoUrl,
          duration: 1,
          respect_moderation: true,
        },
        model: 'grok-imagine-video',
        progress: 100,
      });
    }

    return Response.json({ error: 'unexpected request' }, { status: 500 });
  };
}

async function runScenario(mode: 'generation' | 'editing') {
  const xai = createXai({
    apiKey: 'test-api-key',
    baseURL,
    fetch: createPollingFetch(),
  });

  const xaiOptions =
    mode === 'editing'
      ? {
          mode: 'edit-video' as const,
          videoUrl: 'https://example.com/input.mp4',
          pollIntervalMs: 1,
          pollTimeoutMs: 1000,
        }
      : {
          pollIntervalMs: 1,
          pollTimeoutMs: 1000,
        };

  const result = await xai.video('grok-imagine-video').doGenerate({
    prompt: `Reproduction for xAI video ${mode}`,
    n: 1,
    image: undefined,
    frameImages: undefined,
    inputReferences: undefined,
    aspectRatio: undefined,
    resolution: undefined,
    duration: undefined,
    fps: undefined,
    seed: undefined,
    generateAudio: undefined,
    providerOptions: { xai: { ...xaiOptions } },
  });

  const video = result.videos[0];
  if (video?.type !== 'url' || video.url !== completedVideoUrl) {
    throw new Error(`${mode} did not return the completed video`);
  }
}

async function main() {
  const scenarios = ['generation', 'editing'] as const;
  const results = await Promise.allSettled(scenarios.map(runScenario));
  const failedScenarios = results.flatMap((result, index) =>
    result.status === 'rejected' ? [scenarios[index]] : [],
  );

  if (failedScenarios.length > 0) {
    throw new Error(
      `ISSUE 17308 REPRODUCED: empty HTTP 202 stopped xAI video polling for ${failedScenarios.join(
        ' and ',
      )} instead of returning the completed video`,
    );
  }

  console.log(
    'Empty HTTP 202 responses were treated as in progress for generation and editing.',
  );
}

main();
