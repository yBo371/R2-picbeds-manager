import { decodeRouteKey, errorResponse, getContentType, type Env, type PagesFunction } from '../types';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;

  if (!env.BUCKET) {
    return errorResponse('R2 bucket binding BUCKET is not configured.', 500);
  }

  const key = decodeRouteKey(params.key);

  if (!key) {
    return errorResponse('Image key is required.', 400);
  }

  try {
    const object = await env.BUCKET.get(key);

    if (!object) {
      return errorResponse('Image not found.', 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': getContentType(key, object),
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: object.httpEtag
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 get error.';
    return errorResponse(`Failed to read image: ${message}`, 500);
  }
};
