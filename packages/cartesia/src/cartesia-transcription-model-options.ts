import { z } from 'zod/v4';

// https://docs.cartesia.ai/api-reference/stt/transcribe
export const cartesiaTranscriptionModelOptionsSchema = z.object({
  /** The language of the audio (ISO 639-1 code). If not specified, the language is auto-detected. */
  language: z.string().nullish(),
  /** The timestamp granularities to populate. Currently only `word` is supported. */
  timestampGranularities: z.array(z.enum(['word'])).nullish(),
});

export type CartesiaTranscriptionModelOptions = z.infer<
  typeof cartesiaTranscriptionModelOptionsSchema
>;
