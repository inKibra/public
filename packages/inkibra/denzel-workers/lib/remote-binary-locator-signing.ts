import type { MimeType } from '@inkibra/api-base/constants/mime-type';
import type {
  RemoteBinaryLocatorAccessTokenPayload,
  RemoteBinaryLocatorRequest,
} from '@inkibra/api-base/constants/remote-binary-locator';

type JwtHeader = {
  alg: string;
  typ?: string;
};

type JwtEnvelope<TPayload> = {
  iss: string;
  sub: string;
  aud: string[];
  jti: string;
  iat: number;
  exp: number;
  payload: TPayload;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(paddingNeeded);
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = normalizeBase64Url(value);
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function parseBase64UrlJson<T>(value: string, description: string): T {
  try {
    const jsonString = textDecoder.decode(base64UrlToUint8Array(value));
    return JSON.parse(jsonString) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${description}: ${error}`);
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto API is not available in this environment');
  }
  return await globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign', 'verify'],
  );
}

export async function validateSignedRemoteBinaryLocatorRequest<
  Type extends string,
  TMimeType extends MimeType = MimeType,
>(
  signature: string,
  secret: string,
  issuer: string,
): Promise<RemoteBinaryLocatorRequest<Type, TMimeType>> {
  const parts = signature.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const header = parseBase64UrlJson<JwtHeader>(encodedHeader, 'JWT header');

  if (header.alg !== 'HS512') {
    throw new Error(`Unsupported JWT algorithm "${header.alg}"`);
  }

  const payloadEnvelope = parseBase64UrlJson<
    JwtEnvelope<RemoteBinaryLocatorAccessTokenPayload<Type, TMimeType>>
  >(encodedPayload, 'JWT payload');

  if (!Array.isArray(payloadEnvelope.aud)) {
    throw new Error('JWT payload is missing an audience array');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payloadEnvelope.exp !== 'number') {
    throw new Error('JWT payload is missing an expiration');
  }
  if (payloadEnvelope.exp < nowSeconds) {
    throw new Error('JWT has expired');
  }

  if (payloadEnvelope.iss !== issuer) {
    throw new Error('JWT issuer mismatch');
  }

  if (!payloadEnvelope.aud.includes(issuer)) {
    throw new Error('JWT audience does not include issuer');
  }

  const request = payloadEnvelope.payload?.request;
  if (!request) {
    throw new Error('JWT payload is missing request data');
  }

  if (payloadEnvelope.sub !== request.id) {
    throw new Error('JWT subject does not match request id');
  }

  const key = await importHmacKey(secret);
  const data = textEncoder.encode(`${encodedHeader}.${encodedPayload}`);
  const providedSignatureBytes = base64UrlToUint8Array(encodedSignature);

  // Compute expected signature using sign (constant-time operation)
  const expectedSignatureBytes = new Uint8Array(
    await globalThis.crypto.subtle.sign('HMAC', key, data),
  );

  // Ensure both signatures have the same length before comparison
  if (providedSignatureBytes.length !== expectedSignatureBytes.length) {
    throw new Error('Invalid JWT signature');
  }

  // Use timing-safe comparison to prevent timing attacks
  // Assert the existence of timingSafeEqual for correct type safety
  const subtle = globalThis.crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  };
  if (!subtle.timingSafeEqual(providedSignatureBytes, expectedSignatureBytes)) {
    throw new Error('Invalid JWT signature');
  }

  return request;
}
