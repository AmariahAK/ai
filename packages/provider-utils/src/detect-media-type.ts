import { convertBase64ToUint8Array } from './uint8-utils';

const imageMediaTypeSignatures = [
  {
    mediaType: 'image/gif' as const,
    bytesPrefix: [0x47, 0x49, 0x46], // GIF
  },
  {
    mediaType: 'image/png' as const,
    bytesPrefix: [0x89, 0x50, 0x4e, 0x47], // PNG
  },
  {
    mediaType: 'image/jpeg' as const,
    bytesPrefix: [0xff, 0xd8], // JPEG
  },
  {
    mediaType: 'image/webp' as const,
    bytesPrefix: [
      0x52,
      0x49,
      0x46,
      0x46, // "RIFF"
      null,
      null,
      null,
      null, // file size (variable)
      0x57,
      0x45,
      0x42,
      0x50, // "WEBP"
    ],
  },
  {
    mediaType: 'image/bmp' as const,
    bytesPrefix: [0x42, 0x4d],
  },
  {
    mediaType: 'image/tiff' as const,
    bytesPrefix: [0x49, 0x49, 0x2a, 0x00],
  },
  {
    mediaType: 'image/tiff' as const,
    bytesPrefix: [0x4d, 0x4d, 0x00, 0x2a],
  },
  {
    mediaType: 'image/avif' as const,
    bytesPrefix: [
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ],
  },
  {
    mediaType: 'image/heic' as const,
    bytesPrefix: [
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ],
  },
] as const;

const documentMediaTypeSignatures = [
  {
    mediaType: 'application/pdf' as const,
    bytesPrefix: [0x25, 0x50, 0x44, 0x46], // %PDF
  },
] as const;

const audioMediaTypeSignatures = [
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xfb],
  },
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xfa],
  },
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xf3],
  },
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xf2],
  },
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xe3],
  },
  {
    mediaType: 'audio/mpeg' as const,
    bytesPrefix: [0xff, 0xe2],
  },
  {
    mediaType: 'audio/wav' as const,
    bytesPrefix: [
      0x52, // R
      0x49, // I
      0x46, // F
      0x46, // F
      null,
      null,
      null,
      null,
      0x57, // W
      0x41, // A
      0x56, // V
      0x45, // E
    ],
  },
  {
    mediaType: 'audio/ogg' as const,
    bytesPrefix: [0x4f, 0x67, 0x67, 0x53],
  },
  {
    mediaType: 'audio/flac' as const,
    bytesPrefix: [0x66, 0x4c, 0x61, 0x43],
  },
  {
    mediaType: 'audio/aac' as const,
    bytesPrefix: [0x40, 0x15, 0x00, 0x00],
  },
  {
    mediaType: 'audio/mp4' as const,
    bytesPrefix: [0x66, 0x74, 0x79, 0x70],
  },
  {
    mediaType: 'audio/webm',
    bytesPrefix: [0x1a, 0x45, 0xdf, 0xa3],
  },
] as const;

const videoMediaTypeSignatures = [
  {
    mediaType: 'video/mp4' as const,
    bytesPrefix: [
      0x00,
      0x00,
      0x00,
      null,
      0x66,
      0x74,
      0x79,
      0x70, // ftyp
    ],
  },
  {
    mediaType: 'video/webm' as const,
    bytesPrefix: [0x1a, 0x45, 0xdf, 0xa3], // EBML
  },
  {
    mediaType: 'video/quicktime' as const,
    bytesPrefix: [
      0x00,
      0x00,
      0x00,
      0x14,
      0x66,
      0x74,
      0x79,
      0x70,
      0x71,
      0x74, // ftypqt
    ],
  },
  {
    mediaType: 'video/x-msvideo' as const,
    bytesPrefix: [0x52, 0x49, 0x46, 0x46], // RIFF (AVI)
  },
] as const;

const DEFAULT_SNIFF_BYTES = 18;
// Bounded prefix scanned past an ID3v2 tag; keeps detection O(1) in input size
// while still covering typical tags with embedded cover art.
const ID3_MAX_SCAN_BYTES = 128 * 1024;

// Decode/view at most `maxBytes` from the front of the input.
function decodePrefix(data: Uint8Array | string, maxBytes: number): Uint8Array {
  if (typeof data !== 'string') {
    return data.length > maxBytes ? data.subarray(0, maxBytes) : data;
  }
  const maxChars = Math.ceil(maxBytes / 3) * 4; // base64: 4 chars -> 3 bytes
  return convertBase64ToUint8Array(
    data.substring(0, Math.min(data.length, maxChars)),
  );
}

function hasID3(bytes: Uint8Array): boolean {
  return (
    bytes.length > 10 &&
    bytes[0] === 0x49 && // 'I'
    bytes[1] === 0x44 && // 'D'
    bytes[2] === 0x33 // '3'
  );
}

const stripID3 = (bytes: Uint8Array): Uint8Array => {
  const id3Size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return bytes.subarray(id3Size + 10);
};

type MediaTypeSignatures = ReadonlyArray<{
  readonly mediaType: string;
  readonly bytesPrefix: ReadonlyArray<number | null>;
}>;

function detectMediaTypeBySignatures<T extends MediaTypeSignatures>({
  data,
  signatures,
}: {
  data: Uint8Array | string;
  signatures: T;
}): T[number]['mediaType'] | undefined {
  let bytes = decodePrefix(data, DEFAULT_SNIFF_BYTES);

  // ID3v2-tagged MP3s carry the audio frame after the tag; scan a bounded
  // prefix past it rather than decoding the whole input.
  if (hasID3(bytes)) {
    bytes = stripID3(decodePrefix(data, ID3_MAX_SCAN_BYTES));
  }

  for (const signature of signatures) {
    if (
      bytes.length >= signature.bytesPrefix.length &&
      signature.bytesPrefix.every(
        (byte, index) => byte === null || bytes[index] === byte,
      )
    ) {
      return signature.mediaType;
    }
  }

  return undefined;
}

const topLevelSignatureTables = {
  image: imageMediaTypeSignatures,
  audio: audioMediaTypeSignatures,
  video: videoMediaTypeSignatures,
  application: documentMediaTypeSignatures,
} as const;

type TopLevelMediaType = keyof typeof topLevelSignatureTables;

/**
 * Detect the IANA media type of a file from its raw bytes or base64 string.
 *
 * - When `topLevelType` is omitted, every known signature is considered
 *   (image, audio, video, and application). Returns `undefined` when the
 *   bytes do not match any known signature.
 * - When `topLevelType` is provided, only signatures for that top-level
 *   segment are considered. Returns `undefined` for unsupported segments
 *   (e.g. `"text"`) or when no signature matches.
 */
export function detectMediaType({
  data,
  topLevelType,
}: {
  data: Uint8Array | string;
  topLevelType?: string;
}): string | undefined {
  if (topLevelType === undefined) {
    return detectMediaTypeBySignatures({
      data,
      signatures: [
        ...imageMediaTypeSignatures,
        ...documentMediaTypeSignatures,
        ...audioMediaTypeSignatures,
        ...videoMediaTypeSignatures,
      ],
    });
  }

  const signatures = topLevelSignatureTables[topLevelType as TopLevelMediaType];

  if (signatures === undefined) {
    return undefined;
  }

  return detectMediaTypeBySignatures({ data, signatures });
}

/**
 * Returns the top-level segment of a media type (the portion before `/`).
 *
 * Examples:
 *   - `"image/png"` -> `"image"`
 *   - `"image/*"` -> `"image"`
 *   - `"image"` -> `"image"`
 *   - `"image/"` -> `"image"`
 *   - `""` -> `""`
 *   - `"/"` -> `""`
 */
export function getTopLevelMediaType(mediaType: string): string {
  const slashIndex = mediaType.indexOf('/');
  return slashIndex === -1 ? mediaType : mediaType.substring(0, slashIndex);
}

/**
 * Returns `true` only when the given media type has a non-empty, non-wildcard
 * subtype (i.e. matches the form `type/subtype`, and `subtype` is not `*`).
 *
 * Examples:
 *   - `"image/png"` -> `true`
 *   - `"image/*"` -> `false`
 *   - `"image"` -> `false`
 *   - `"image/"` -> `false`
 *   - `""` -> `false`
 *   - `"/"` -> `false`
 */
export function isFullMediaType(mediaType: string): boolean {
  const slashIndex = mediaType.indexOf('/');
  if (slashIndex === -1) {
    return false;
  }
  const subtype = mediaType.substring(slashIndex + 1);
  return subtype.length > 0 && subtype !== '*';
}
