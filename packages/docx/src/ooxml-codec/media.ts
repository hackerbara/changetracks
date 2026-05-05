export interface ParsedDataUriMediaPart {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export function dataUriToMediaPart(uri: string): ParsedDataUriMediaPart {
  const match = uri.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) {
    throw new Error("Only base64 data URI image sources are supported");
  }

  const contentType = match[1]?.toLowerCase();
  if (!contentType) {
    throw new Error("Data URI is missing a content type");
  }

  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    throw new Error(`Unsupported data URI content type: ${contentType}`);
  }

  return { contentType, extension, bytes: base64ToBytes(match[2] ?? "") };
}

export function allocateMediaPartName(
  existing: ReadonlySet<string>,
  extension: string,
): string {
  const normalizedExtension = extension.startsWith(".")
    ? extension.slice(1).toLowerCase()
    : extension.toLowerCase();
  let index = 1;
  while (existing.has(`word/media/image${index}.${normalizedExtension}`)) {
    index += 1;
  }
  return `word/media/image${index}.${normalizedExtension}`;
}

export function stableBytesHash(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function base64ToBytes(value: string): Uint8Array {
  assertValidBase64Payload(value);

  const bufferConstructor = (globalThis as {
    Buffer?: {
      from(input: string, encoding: "base64"): Uint8Array;
      from(input: Uint8Array): { toString(encoding: "base64"): string };
    };
  }).Buffer;
  if (bufferConstructor) {
    const bytes = new Uint8Array(bufferConstructor.from(value, "base64"));
    assertBase64RoundTrips(value, bytes);
    return bytes;
  }

  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (!atobFn) {
    throw new Error("No base64 decoder is available in this environment");
  }

  const binary = atobFn(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  assertBase64RoundTrips(value, bytes);
  return bytes;
}

function assertValidBase64Payload(value: string): void {
  if (!value) {
    throw new Error("Invalid base64 data URI payload");
  }
  if (value.length % 4 !== 0) {
    throw new Error("Invalid base64 data URI payload");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid base64 data URI payload");
  }
}

function assertBase64RoundTrips(value: string, bytes: Uint8Array): void {
  if (bytesToBase64(bytes) !== value) {
    throw new Error("Invalid base64 data URI payload");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferConstructor = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: "base64"): string } };
  }).Buffer;
  if (bufferConstructor) {
    return bufferConstructor.from(bytes).toString("base64");
  }

  const btoaFn = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (!btoaFn) {
    throw new Error("No base64 encoder is available in this environment");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoaFn(binary);
}
