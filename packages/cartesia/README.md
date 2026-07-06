# AI SDK - Cartesia Provider

The **[Cartesia provider](https://ai-sdk.dev/providers/ai-sdk-providers/cartesia)** for the [AI SDK](https://ai-sdk.dev/docs)
contains speech model support for the Cartesia text-to-speech API (Sonic) and transcription model support for the Cartesia speech-to-text API (Ink-Whisper).

> **Deploying to Vercel?** With Vercel's AI Gateway you can access Cartesia (and hundreds of models from other providers) — no additional packages, API keys, or extra cost. [Get started with AI Gateway](https://vercel.com/ai-gateway).

## Setup

The Cartesia provider is available in the `@ai-sdk/cartesia` module. You can install it with

```bash
npm i @ai-sdk/cartesia
```

## Provider Instance

You can import the default provider instance `cartesia` from `@ai-sdk/cartesia`:

```ts
import { cartesia } from '@ai-sdk/cartesia';
```

## Example

```ts
import { cartesia } from '@ai-sdk/cartesia';
import { experimental_generateSpeech as generateSpeech } from 'ai';

const { audio } = await generateSpeech({
  model: cartesia.speech('sonic-2'),
  text: 'Hello from the Vercel AI SDK!',
  voice: 'a0e99841-438c-4a64-b679-ae501e7d6091',
});
```

## Documentation

Please check out the **[Cartesia provider documentation](https://ai-sdk.dev/providers/ai-sdk-providers/cartesia)** for more information.
