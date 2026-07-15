import { z } from 'zod/v4';

export type MistralSpeechModelId = 'voxtral-mini-tts-2603' | (string & {});

export const mistralSpeechModelOptions = z.object({
  /**
   * Base64-encoded reference audio to use for one-off voice cloning.
   *
   * This cannot be used together with the standard `voice` option.
   */
  refAudio: z.string().optional(),
});

export type MistralSpeechModelOptions = z.infer<
  typeof mistralSpeechModelOptions
>;
