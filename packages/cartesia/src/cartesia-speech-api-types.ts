export type CartesiaSpeechAPITypes = {
  /**
   * The ID of the model to use for the generation.
   */
  model_id: string;

  /**
   * The transcript to generate speech for.
   */
  transcript: string;

  /**
   * The voice specifier. Cartesia uses id mode with a voice id.
   */
  voice: {
    mode: 'id';
    id: string;
  };

  /**
   * The language to generate speech in (ISO 639-1 code).
   */
  language?: string;

  /**
   * The output audio format.
   */
  output_format: {
    container: string;
    encoding: string;
    sample_rate: number;
    bit_rate?: number;
  };

  /**
   * Controls the speed of the generated speech.
   */
  speed?: number;
};
