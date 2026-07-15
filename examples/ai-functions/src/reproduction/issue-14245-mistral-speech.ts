import { mistral } from '@ai-sdk/mistral';
import { generateSpeech } from 'ai';

async function main() {
  const result = await generateSpeech({
    model: mistral.speech('voxtral-mini-tts-2603'),
    text: 'Hello from the AI SDK. This is a live Mistral speech test.',
    voice: 'en_paul_neutral',
    outputFormat: 'mp3',
    maxRetries: 0,
  });

  const output = {
    byteLength: result.audio.uint8Array.byteLength,
    mediaType: result.audio.mediaType,
    modelId: result.responses[0]?.modelId,
    warnings: result.warnings,
  };

  console.log(JSON.stringify(output, null, 2));

  if (output.byteLength === 0) {
    throw new Error('Mistral returned empty speech audio.');
  }

  if (output.modelId !== 'voxtral-mini-tts-2603') {
    throw new Error(`Unexpected response model id: ${output.modelId}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
