import { decodeRouteKey, errorResponse, getContentType, getFileName, type Env, type PagesFunction } from '../types';

function encodeDownloadFileName(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;

  if (!env.BUCKET) {
    return errorResponse('R2 bucket binding BUCKET is not configured.', 500);
  }

  const key = decodeRouteKey(params.key);

  if (!key) {
    return errorResponse('Download key is required.', 400);
  }

  try {
    const object = await env.BUCKET.get(key);

    if (!object) {
      return errorResponse('File not found.', 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': getContentType(key, object),
        'Content-Length': object.size.toString(),
        'Content-Disposition': encodeDownloadFileName(getFileName(key)),
        'Cache-Control': 'private, max-age=0, must-revalidate',
        ETag: object.httpEtag
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 get error.';
    return errorResponse(`Failed to download file: ${message}`, 500);
  }
};
