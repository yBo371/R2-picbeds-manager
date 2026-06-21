import {
  encodeKeyPath,
  errorResponse,
  getBaseUrl,
  getContentType,
  getFileName,
  isImageKey,
  jsonResponse,
  type Env,
  type PagesFunction,
  type R2Object
} from '../types';

type SortBy = 'uploaded' | 'size' | 'name' | 'contentType' | 'extension';
type SortOrder = 'asc' | 'desc';

interface PrefixItem {
  name: string;
  prefix: string;
}

interface ListItem {
  key: string;
  name: string;
  size: number;
  sizeText: string;
  uploaded: string | null;
  uploadedText: string;
  contentType: string;
  extension: string;
  etag: string | null;
  imageUrl: string;
  downloadUrl: string;
  markdown: string;
}

const MAX_SORT_OBJECTS = 5000;
const R2_LIST_LIMIT = 1000;

function normalizePrefix(value: string | null): string {
  const prefix = (value ?? '').trim().replace(/^\/+/, '');

  if (!prefix) {
    return '';
  }

  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function getParentPrefix(prefix: string): string | null {
  const trimmed = prefix.replace(/\/+$/, '');

  if (!trimmed) {
    return null;
  }

  const slashIndex = trimmed.lastIndexOf('/');
  return slashIndex === -1 ? '' : `${trimmed.slice(0, slashIndex)}/`;
}

function parseSortBy(value: string | null): SortBy {
  if (value === 'size' || value === 'name' || value === 'contentType' || value === 'extension') {
    return value;
  }

  return 'uploaded';
}

function parseSortOrder(value: string | null): SortOrder {
  return value === 'asc' ? 'asc' : 'desc';
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return '未知大小';
  }

  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  if (index === 0) {
    return `${Math.round(value)} ${units[index]}`;
  }

  return `${value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} ${units[index]}`;
}

function formatUploadedText(uploaded: Date | undefined): string {
  if (!uploaded || Number.isNaN(uploaded.getTime())) {
    return '未知时间';
  }

  const pad = (value: number) => value.toString().padStart(2, '0');

  return [
    `${uploaded.getFullYear()}-${pad(uploaded.getMonth() + 1)}-${pad(uploaded.getDate())}`,
    `${pad(uploaded.getHours())}:${pad(uploaded.getMinutes())}`
  ].join(' ');
}

function getExtension(key: string): string {
  const name = getFileName(key);
  const dotIndex = name.lastIndexOf('.');

  if (dotIndex === -1 || dotIndex === name.length - 1) {
    return '';
  }

  return name.slice(dotIndex + 1).toLowerCase();
}

function createPrefixItem(currentPrefix: string, folderPrefix: string): PrefixItem | null {
  if (!folderPrefix.startsWith(currentPrefix) || folderPrefix === currentPrefix) {
    return null;
  }

  const relativeName = folderPrefix.slice(currentPrefix.length).replace(/\/+$/, '');

  if (!relativeName) {
    return null;
  }

  return {
    name: relativeName.split('/').pop() ?? relativeName,
    prefix: folderPrefix
  };
}

function createListItem(object: R2Object, baseUrl: string): ListItem {
  const encodedKey = encodeKeyPath(object.key);
  const imageUrl = `/image/${encodedKey}`;
  const downloadUrl = `/download/${encodedKey}`;
  const markdownImageUrl = `${baseUrl}/${encodedKey}`;
  const size = Number.isFinite(object.size) ? object.size : 0;
  const uploaded = object.uploaded && !Number.isNaN(object.uploaded.getTime()) ? object.uploaded.toISOString() : null;
  const contentType = getContentType(object.key, object);
  const extension = getExtension(object.key);

  return {
    key: object.key,
    name: getFileName(object.key),
    size,
    sizeText: formatBytes(Number.isFinite(object.size) ? object.size : null),
    uploaded,
    uploadedText: formatUploadedText(object.uploaded),
    contentType,
    extension,
    etag: object.httpEtag ?? object.etag ?? null,
    imageUrl,
    downloadUrl,
    markdown: `![](${markdownImageUrl})`
  };
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', {
    numeric: true,
    sensitivity: 'base'
  });
}

function getSortValue(item: ListItem, sortBy: SortBy): string | number | null {
  if (sortBy === 'uploaded') {
    return item.uploaded ? Date.parse(item.uploaded) : null;
  }

  if (sortBy === 'size') {
    return Number.isFinite(item.size) ? item.size : null;
  }

  return item[sortBy];
}

function sortItems(items: ListItem[], sortBy: SortBy, sortOrder: SortOrder): ListItem[] {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return [...items].sort((left, right) => {
    const leftValue = getSortValue(left, sortBy);
    const rightValue = getSortValue(right, sortBy);

    if (leftValue === null && rightValue === null) {
      return compareText(left.name, right.name);
    }

    if (leftValue === null) {
      return 1;
    }

    if (rightValue === null) {
      return -1;
    }

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      const compared = leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
      return compared === 0 ? compareText(left.name, right.name) : compared * direction;
    }

    const compared = compareText(String(leftValue), String(rightValue));
    return compared === 0 ? compareText(left.name, right.name) : compared * direction;
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.BUCKET) {
    return errorResponse('R2 bucket binding BUCKET is not configured.', 500);
  }

  const url = new URL(request.url);
  const prefix = normalizePrefix(url.searchParams.get('prefix'));
  const initialCursor = url.searchParams.get('cursor') ?? undefined;
  const sortBy = parseSortBy(url.searchParams.get('sortBy'));
  const sortOrder = parseSortOrder(url.searchParams.get('sortOrder'));
  const baseUrl = getBaseUrl(request, env.PUBLIC_BASE_URL);
  const prefixes = new Map<string, PrefixItem>();
  const objects: R2Object[] = [];
  let cursor = initialCursor;
  let limited = false;

  try {
    while (true) {
      const result = await env.BUCKET.list({
        prefix,
        cursor,
        delimiter: '/',
        limit: R2_LIST_LIMIT
      });

      for (const folderPrefix of result.delimitedPrefixes ?? []) {
        const item = createPrefixItem(prefix, folderPrefix);

        if (item) {
          prefixes.set(item.prefix, item);
        }
      }

      for (const object of result.objects) {
        if (!isImageKey(object.key)) {
          continue;
        }

        if (objects.length >= MAX_SORT_OBJECTS) {
          limited = true;
          break;
        }

        objects.push(object);
      }

      if (limited || !result.truncated || !result.cursor) {
        break;
      }

      cursor = result.cursor;
    }

    const items = sortItems(
      objects.map((object) => createListItem(object, baseUrl)),
      sortBy,
      sortOrder
    );
    const prefixItems = [...prefixes.values()].sort((left, right) => compareText(left.name, right.name));
    const totalSize = items.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0);
    const limitMessage = limited ? `当前目录图片太多，只排序了前 ${MAX_SORT_OBJECTS} 个对象` : null;

    return jsonResponse({
      prefix,
      parentPrefix: getParentPrefix(prefix),
      prefixes: prefixItems,
      items,
      sortBy,
      sortOrder,
      count: items.length,
      totalSize,
      totalSizeText: formatBytes(totalSize),
      limited,
      limitMessage,
      cursor: null,
      truncated: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 list error.';
    return errorResponse(`Failed to list R2 objects: ${message}`, 500);
  }
};
