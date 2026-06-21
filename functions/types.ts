export interface R2Object {
  key: string;
  size: number;
  uploaded?: Date;
  httpEtag: string;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export interface EventContext<Env> {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}

export type PagesFunction<Env> = (context: EventContext<Env>) => Response | Promise<Response>;

export interface Env {
  BUCKET?: R2Bucket;
  PUBLIC_BASE_URL?: string;
}

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg']);

export function isImageKey(key: string): boolean {
  const lastSegment = key.split('/').pop() ?? key;
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex === -1) {
    return false;
  }

  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

export function getFileName(key: string): string {
  const normalized = key.endsWith('/') ? key.slice(0, -1) : key;
  return normalized.split('/').pop() || normalized || key;
}

export function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function decodeRouteKey(rawKey: string | string[] | undefined): string {
  const joinedKey = Array.isArray(rawKey) ? rawKey.join('/') : rawKey ?? '';

  try {
    return decodeURIComponent(joinedKey);
  } catch {
    return joinedKey;
  }
}

export function getBaseUrl(request: Request, configuredBaseUrl?: string): string {
  if (configuredBaseUrl?.trim()) {
    return configuredBaseUrl.trim().replace(/\/+$/, '');
  }

  const url = new URL(request.url);
  return url.origin;
}

export function getContentType(key: string, object?: R2ObjectBody | R2Object): string {
  const objectType = object?.httpMetadata?.contentType;

  if (objectType) {
    return objectType;
  }

  const extension = key.split('.').pop()?.toLowerCase();
  const fallbackTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml'
  };

  return fallbackTypes[extension ?? ''] ?? 'application/octet-stream';
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init.headers
    }
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, { status });
}
