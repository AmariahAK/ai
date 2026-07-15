import {
  InvalidArgumentError,
  type SharedV4Warning,
  type SpeechModelV4,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createJsonResponseHandler,
  parseProviderOptions,
  postToApi,
  serializeModelOptions,
  WORKFLOW_DESERIALIZE,
  WORKFLOW_SERIALIZE,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { mistralFailedResponseHandler } from './mistral-error';
import {
  mistralSpeechModelOptions,
  type MistralSpeechModelId,
} from './mistral-speech-model-options';

type MistralSpeechConfig = {
  provider: string;
  baseURL: string;
  headers?: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: {
    currentDate?: () => Date;
  };
};

type MistralSpeechOutputFormat = 'pcm' | 'wav' | 'mp3' | 'flac' | 'opus';

type MistralSpeechRequest = {
  model: string;
  input: string;
  voice_id?: string;
  ref_audio?: string;
  response_format: MistralSpeechOutputFormat;
  stream: false;
};

const mistralSpeechResponseSchema = z.object({
  audio_data: z.string(),
});

export class MistralSpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4';

  static [WORKFLOW_SERIALIZE](model: MistralSpeechModel) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config,
    });
  }

  static [WORKFLOW_DESERIALIZE](options: {
    modelId: MistralSpeechModelId;
    config: MistralSpeechConfig;
  }) {
    return new MistralSpeechModel(options.modelId, options.config);
  }

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: MistralSpeechModelId,
    private readonly config: MistralSpeechConfig,
  ) {}

  private async getArgs({
    text,
    voice,
    outputFormat = 'mp3',
    instructions,
    speed,
    language,
    providerOptions,
  }: Parameters<SpeechModelV4['doGenerate']>[0]) {
    const warnings: SharedV4Warning[] = [];
    const mistralOptions = await parseProviderOptions({
      provider: 'mistral',
      providerOptions,
      schema: mistralSpeechModelOptions,
    });

    if (voice != null && mistralOptions?.refAudio != null) {
      throw new InvalidArgumentError({
        argument: 'voice',
        message:
          'Mistral speech generation accepts either `voice` or `providerOptions.mistral.refAudio`, but not both.',
      });
    }

    if (voice == null && mistralOptions?.refAudio == null) {
      throw new InvalidArgumentError({
        argument: 'voice',
        message:
          'Mistral speech generation requires either `voice` or `providerOptions.mistral.refAudio`.',
      });
    }

    let resolvedOutputFormat: MistralSpeechOutputFormat = 'mp3';
    if (
      outputFormat === 'pcm' ||
      outputFormat === 'wav' ||
      outputFormat === 'mp3' ||
      outputFormat === 'flac' ||
      outputFormat === 'opus'
    ) {
      resolvedOutputFormat = outputFormat;
    } else {
      warnings.push({
        type: 'unsupported',
        feature: 'outputFormat',
        details: `Unsupported output format: ${outputFormat}. Using mp3 instead.`,
      });
    }

    if (instructions != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details:
          'Mistral speech models do not support the `instructions` option. It was ignored.',
      });
    }

    if (speed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'speed',
        details:
          'Mistral speech models do not support the `speed` option. It was ignored.',
      });
    }

    if (language != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'language',
        details:
          'Mistral speech models do not support the `language` option. Language is inferred from the input text and voice.',
      });
    }

    const requestBody: MistralSpeechRequest = {
      model: this.modelId,
      input: text,
      voice_id: voice,
      ref_audio: mistralOptions?.refAudio,
      response_format: resolvedOutputFormat,
      stream: false,
    };

    return { requestBody, warnings };
  }

  async doGenerate(
    options: Parameters<SpeechModelV4['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<SpeechModelV4['doGenerate']>>> {
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();
    const { requestBody, warnings } = await this.getArgs(options);
    const redactedRequestBody = {
      ...requestBody,
      ref_audio:
        requestBody.ref_audio == null ? undefined : '[base64 audio redacted]',
    };

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postToApi({
      url: `${this.config.baseURL}/audio/speech`,
      headers: {
        ...combineHeaders(this.config.headers?.(), options.headers),
        'Content-Type': 'application/json',
      },
      body: {
        content: JSON.stringify(requestBody),
        values: redactedRequestBody,
      },
      failedResponseHandler: mistralFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        mistralSpeechResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      audio: response.audio_data,
      warnings,
      request: {
        body: redactedRequestBody,
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
