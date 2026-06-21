import { decodeRouteKey, errorResponse, jsonResponse, type Env, type PagesFunction } from '../types';

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, params } = context;

  if (!env.BUCKET) {
    return errorResponse('R2 bucket binding BUCKET is not configured.', 500);
  }

  const key = decodeRouteKey(params.key);

  if (!key) {
    return errorResponse('Delete key is required.', 400);
  }

  try {
    const object = await env.BUCKET.get(key);

    if (!object) {
      return errorResponse('File not found.', 404);
    }

    await env.BUCKET.delete(key);
    return jsonResponse({ ok: true, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 delete error.';
    return errorResponse(`Failed to delete file: ${message}`, 500);
  }
};
