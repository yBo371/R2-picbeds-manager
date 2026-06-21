import {
  encodeKeyPath,
  errorResponse,
  getBaseUrl,
  getFileName,
  isImageKey,
  jsonResponse,
  type Env,
  type PagesFunction
} from '../types';

interface ListItem {
  key: string;
  name: string;
  size: number;
  uploaded: string | null;
  imageUrl: string;
  downloadUrl: string;
  markdown: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.BUCKET) {
    return errorResponse('R2 bucket binding BUCKET is not configured.', 500);
  }

  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') ?? '';
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const baseUrl = getBaseUrl(request, env.PUBLIC_BASE_URL);

  try {
    const result = await env.BUCKET.list({
      prefix,
      cursor,
      limit: 1000
    });

    const items: ListItem[] = result.objects.filter((object) => isImageKey(object.key)).map((object) => {
      const encodedKey = encodeKeyPath(object.key);
      const imageUrl = `/image/${encodedKey}`;
      const downloadUrl = `/download/${encodedKey}`;
      const absoluteImageUrl = `${baseUrl}/image/${encodedKey}`;

      return {
        key: object.key,
        name: getFileName(object.key),
        size: object.size,
        uploaded: object.uploaded ? object.uploaded.toISOString() : null,
        imageUrl,
        downloadUrl,
        markdown: `![](${absoluteImageUrl})`
      };
    });

    return jsonResponse({
      items,
      cursor: result.truncated ? result.cursor : null,
      truncated: result.truncated
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 list error.';
    return errorResponse(`Failed to list R2 objects: ${message}`, 500);
  }
};
