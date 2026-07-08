import type {
  Experimental_TranscriptionModelV4StreamPart as TranscriptionModelV4StreamPart,
  JSONObject,
} from '@ai-sdk/provider';
import { secureJsonParse } from './secure-json-parse';

/**
 * Experimental transcription-stream WebSocket envelope (v1): the standard
 * serialization of `TranscriptionModelV4.doStream` over a WebSocket. Clients
 * (e.g. the `@ai-sdk/gateway` provider) encode with this module and servers
 * (e.g. AI Gateway) decode with it, so the two sides cannot drift.
 *
 * Envelope rules:
 *
 * 1. The client sends exactly one `transcription-stream.start` TEXT frame
 *    first.
 * 2. Audio rides BINARY frames containing raw bytes in the declared
 *    `inputAudioFormat` (base64 string chunks are decoded before sending).
 * 3. The client signals end of audio with the
 *    `transcription-stream.audio-done` TEXT frame; a plain close without it
 *    is an abort.
 * 4. Every server→client TEXT frame is one JSON-serialized
 *    `TranscriptionModelV4StreamPart` (flattened, no wrapper). `Date` values
 *    (`response-metadata.timestamp`) serialize to ISO 8601 strings and are
 *    revived by `parseTranscriptionStreamPart`.
 * 5. The server closes with code 1000 after the `finish` part; on failure it
 *    sends an `error` part and closes non-1000. A close without a prior
 *    `finish` is an error.
 * 6. Unknown frame/part types are ignored in both directions (forward
 *    compatibility).
 * 7. Connection establishment (URL, auth) is transport-specific and out of
 *    scope.
 *
 * The envelope validates frame shape only; server policy (accepted audio
 * formats, required `rate`, size limits) layers on top. Both parsers use
 * `secureJsonParse`, so frames carrying `__proto__` / `constructor.prototype`
 * keys are rejected (prototype-pollution protection) rather than parsed.
 */

/** Type of the first client TEXT frame. */
export const TRANSCRIPTION_STREAM_START_FRAME_TYPE =
  'transcription-stream.start';

/** Type of the client TEXT frame that signals the end of the audio input. */
export const TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE =
  'transcription-stream.audio-done';

/**
 * The client's session start frame. Optional keys are omitted when undefined.
 */
export type Experimental_TranscriptionStreamStartFrame = {
  type: typeof TRANSCRIPTION_STREAM_START_FRAME_TYPE;

  /** Audio format of the binary audio frames, e.g. `{ type: 'audio/pcm', rate: 16000 }`. */
  inputAudioFormat: {
    type: string;
    rate?: number;
  };

  /** Provider-specific options, passed through verbatim. */
  providerOptions?: Record<string, JSONObject>;

  /** When true, the server should include `raw` parts in the stream. */
  includeRawChunks?: boolean;
};

/** Server-side classification of a client TEXT frame. */
export type Experimental_TranscriptionStreamClientFrame =
  | {
      type: 'start';
      frame: Experimental_TranscriptionStreamStartFrame;
    }
  | {
      type: 'audio-done';
    }
  | {
      /** Malformed JSON or a recognized frame with an invalid shape. */
      type: 'invalid';
      message: string;
    }
  | {
      /** Unrecognized frame type; ignore for forward compatibility. */
      type: 'unknown';
    };

const knownStreamPartTypes = new Set<TranscriptionModelV4StreamPart['type']>([
  'error',
  'finish',
  'raw',
  'response-metadata',
  'stream-start',
  'transcript-delta',
  'transcript-final',
  'transcript-partial',
]);

/**
 * Server-side: parse a client TEXT frame. Validates envelope shape only and
 * rejects prototype-pollution payloads (parsed with `secureJsonParse`). Never
 * throws.
 */
export function parseTranscriptionStreamClientFrame(
  text: string,
): Experimental_TranscriptionStreamClientFrame {
  let value: unknown;
  try {
    value = secureJsonParse(text);
  } catch {
    return { type: 'invalid', message: 'malformed JSON' };
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { type: 'invalid', message: 'frame must be a JSON object' };
  }

  const frame = value as Record<string, unknown>;

  if (typeof frame.type !== 'string') {
    return { type: 'invalid', message: 'frame type must be a string' };
  }

  switch (frame.type) {
    case TRANSCRIPTION_STREAM_START_FRAME_TYPE: {
      const inputAudioFormat = frame.inputAudioFormat as
        | Record<string, unknown>
        | null
        | undefined;
      if (
        inputAudioFormat == null ||
        typeof inputAudioFormat !== 'object' ||
        Array.isArray(inputAudioFormat) ||
        typeof inputAudioFormat.type !== 'string'
      ) {
        return {
          type: 'invalid',
          message:
            'start frame must have an inputAudioFormat object with a string type',
        };
      }
      if (
        inputAudioFormat.rate !== undefined &&
        typeof inputAudioFormat.rate !== 'number'
      ) {
        return {
          type: 'invalid',
          message: 'inputAudioFormat.rate must be a number when present',
        };
      }
      if (
        frame.providerOptions !== undefined &&
        (frame.providerOptions == null ||
          typeof frame.providerOptions !== 'object' ||
          Array.isArray(frame.providerOptions))
      ) {
        return {
          type: 'invalid',
          message: 'providerOptions must be an object when present',
        };
      }
      if (
        frame.includeRawChunks !== undefined &&
        typeof frame.includeRawChunks !== 'boolean'
      ) {
        return {
          type: 'invalid',
          message: 'includeRawChunks must be a boolean when present',
        };
      }
      return {
        type: 'start',
        frame: frame as Experimental_TranscriptionStreamStartFrame,
      };
    }

    case TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE:
      return { type: 'audio-done' };

    default:
      return { type: 'unknown' };
  }
}

/** Server-side: serialize a transcription stream part as one TEXT frame. */
export function serializeTranscriptionStreamPart(
  part: TranscriptionModelV4StreamPart,
): string {
  return JSON.stringify(part);
}

/**
 * Client-side: parse a server TEXT frame into a transcription stream part.
 * Returns `undefined` for malformed or unsafe (prototype-polluting) JSON and
 * unknown part types (parsed with `secureJsonParse`). Revives
 * `response-metadata.timestamp` to a `Date`.
 */
export function parseTranscriptionStreamPart(
  text: string,
): TranscriptionModelV4StreamPart | undefined {
  let value: unknown;
  try {
    value = secureJsonParse(text);
  } catch {
    return undefined;
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const part = value as TranscriptionModelV4StreamPart;

  if (!knownStreamPartTypes.has(part.type)) {
    return undefined;
  }

  if (part.type === 'response-metadata') {
    return {
      ...part,
      timestamp: part.timestamp != null ? new Date(part.timestamp) : undefined,
    };
  }

  return part;
}
