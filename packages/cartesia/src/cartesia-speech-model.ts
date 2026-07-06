import type { SpeechModelV4, SharedV4Warning } from '@ai-sdk/provider';
import {
  combineHeaders,
  createBinaryResponseHandler,
  parseProviderOptions,
  postJsonToApi,
  serializeModelOptions,
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE,
} from '@ai-sdk/provider-utils';
import type { CartesiaConfig } from './cartesia-config';
import { cartesiaFailedResponseHandler } from './cartesia-error';
import { cartesiaSpeechModelOptionsSchema } from './cartesia-speech-model-options';
import type { CartesiaSpeechAPITypes } from './cartesia-speech-api-types';
import type {
  CartesiaSpeechModelId,
  CartesiaSpeechVoiceId,
} from './cartesia-speech-options';

interface CartesiaSpeechModelConfig extends CartesiaConfig {
  _internal?: {
    currentDate?: () => Date;
  };
}

// Default output format used when no outputFormat / provider options are set.
const DEFAULT_OUTPUT_FORMAT: CartesiaSpeechAPITypes['output_format'] = {
  container: 'mp3',
  encoding: 'mp3',
  sample_rate: 44100,
  bit_rate: 128000,
};

export class CartesiaSpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4';

  get provider(): string {
    return this.config.provider;
  }

  static [WORKFLOW_SERIALIZE](model: CartesiaSpeechModel) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config,
    });
  }

  static [WORKFLOW_DESERIALIZE](options: {
    modelId: CartesiaSpeechModelId;
    config: CartesiaSpeechModelConfig;
  }) {
    return new CartesiaSpeechModel(options.modelId, options.config);
  }

  constructor(
    readonly modelId: CartesiaSpeechModelId,
    private readonly config: CartesiaSpeechModelConfig,
  ) {}

  private async getArgs({
    text,
    voice,
    outputFormat = 'mp3',
    instructions,
    language,
    speed,
    providerOptions,
  }: Parameters<SpeechModelV4['doGenerate']>[0]) {
    const warnings: SharedV4Warning[] = [];

    // Parse provider options
    const cartesiaOptions = await parseProviderOptions({
      provider: 'cartesia',
      providerOptions,
      schema: cartesiaSpeechModelOptionsSchema,
    });

    if (!voice) {
      throw new Error('Cartesia speech models require a `voice` to be set.');
    }

    // Build the base output format from the SDK's flat `outputFormat` string.
    const outputFormatObject: CartesiaSpeechAPITypes['output_format'] = {
      ...DEFAULT_OUTPUT_FORMAT,
    };

    if (outputFormat) {
      const formatLower = outputFormat.toLowerCase();

      // Common format mappings. Cartesia expects a structured output_format.
      // https://docs.cartesia.ai/api-reference/tts/bytes
      const formatMap: Record<
        string,
        { container: string; encoding: string; sampleRate: number }
      > = {
        mp3: { container: 'mp3', encoding: 'mp3', sampleRate: 44100 },
        wav: { container: 'wav', encoding: 'pcm_s16le', sampleRate: 44100 },
        pcm: { container: 'raw', encoding: 'pcm_f32le', sampleRate: 44100 },
        raw: { container: 'raw', encoding: 'pcm_f32le', sampleRate: 44100 },
        mulaw: { container: 'raw', encoding: 'pcm_mulaw', sampleRate: 8000 },
        alaw: { container: 'raw', encoding: 'pcm_alaw', sampleRate: 8000 },
      };

      // Try direct match first, then try "<format>_<sampleRate>" pattern.
      const parts = formatLower.split('_');
      const mapped = formatMap[parts[0]];

      if (mapped) {
        outputFormatObject.container = mapped.container;
        outputFormatObject.encoding = mapped.encoding;
        outputFormatObject.sample_rate = mapped.sampleRate;
        if (mapped.container === 'mp3') {
          outputFormatObject.bit_rate = 128000;
        } else {
          delete outputFormatObject.bit_rate;
        }

        // Optional sample rate suffix, e.g. "wav_24000" or "pcm_16000".
        if (parts.length >= 2) {
          const parsedRate = parseInt(parts[1], 10);
          if (!Number.isNaN(parsedRate)) {
            outputFormatObject.sample_rate = parsedRate;
          }
        }
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'outputFormat',
          details: `Unknown output format "${outputFormat}". Falling back to mp3. Use providerOptions.cartesia to configure container/encoding/sampleRate directly.`,
        });
      }
    }

    // Create request body
    const requestBody: CartesiaSpeechAPITypes = {
      model_id: this.modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voice as CartesiaSpeechVoiceId,
      },
      output_format: outputFormatObject,
    };

    // Map generic language
    if (language) {
      requestBody.language = language;
    }

    // Map generic speed
    if (speed != null) {
      requestBody.speed = speed;
    }

    // Add provider-specific options - map camelCase to snake_case
    if (cartesiaOptions) {
      if (cartesiaOptions.container != null) {
        requestBody.output_format.container = cartesiaOptions.container;
      }
      if (cartesiaOptions.encoding != null) {
        requestBody.output_format.encoding = cartesiaOptions.encoding;
      }
      if (cartesiaOptions.sampleRate != null) {
        requestBody.output_format.sample_rate = cartesiaOptions.sampleRate;
      }
      if (cartesiaOptions.bitRate != null) {
        requestBody.output_format.bit_rate = cartesiaOptions.bitRate;
      }
      if (cartesiaOptions.speed != null) {
        requestBody.speed = cartesiaOptions.speed;
      }
      if (cartesiaOptions.language != null) {
        requestBody.language = cartesiaOptions.language;
      }
    }

    // Remove bit_rate for non-mp3 containers where it is not applicable.
    if (requestBody.output_format.container !== 'mp3') {
      delete requestBody.output_format.bit_rate;
    }

    if (instructions) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: `Cartesia speech models do not support instructions. Instructions parameter was ignored.`,
      });
    }

    return {
      requestBody,
      warnings,
    };
  }

  async doGenerate(
    options: Parameters<SpeechModelV4['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<SpeechModelV4['doGenerate']>>> {
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();
    const { requestBody, warnings } = await this.getArgs(options);

    const {
      value: audio,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: '/tts/bytes',
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers?.(), options.headers),
      body: requestBody,
      failedResponseHandler: cartesiaFailedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      audio,
      warnings,
      request: {
        body: JSON.stringify(requestBody),
      },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
    };
  }
}
