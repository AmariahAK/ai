import * as backendAi from 'ai-backend-5-0-114';
import * as frontendAi from 'ai-frontend-5-0-53';

async function main() {
  console.log(
    'Reproducing issue #11269 with backend ai@5.0.114 and frontend ai@5.0.53',
  );

  const backendStream = backendAi.createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: 'start' });
      writer.write({ type: 'text-start', id: 'text-1' });
      writer.write({ type: 'text-delta', id: 'text-1', delta: 'hello' });
      writer.write({ type: 'text-end', id: 'text-1' });
      writer.write({ type: 'finish-step' });
      writer.write({ type: 'finish', finishReason: 'stop' });
    },
  });

  const response = backendAi.createUIMessageStreamResponse({
    stream: backendStream,
  });

  if (response.body == null) {
    throw new Error('Expected backend response to have a body.');
  }

  const [streamForInspection, streamForFrontend] = response.body.tee();
  const sseText = await new Response(streamForInspection).text();

  console.log('Backend SSE stream:');
  console.log(sseText);

  if (!sseText.includes('"type":"finish","finishReason":"stop"')) {
    throw new Error(
      'Expected backend ai@5.0.114 to emit a finish chunk with finishReason.',
    );
  }

  const parsedStream = frontendAi.parseJsonEventStream({
    stream: streamForFrontend,
    schema: frontendAi.uiMessageChunkSchema,
  });

  const reader = parsedStream.getReader();

  while (true) {
    const { done, value: result } = await reader.read();
    if (done) {
      break;
    }

    if (!result.success) {
      console.error(
        'Old frontend ai@5.0.53 rejected the backend finish chunk:',
      );
      throw result.error;
    }
  }

  throw new Error(
    'Expected frontend ai@5.0.53 to reject the finishReason chunk, but it accepted the stream.',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
