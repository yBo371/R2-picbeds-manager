import './style.css';

type SortBy = 'uploaded' | 'size' | 'name';
type SortOrder = 'asc' | 'desc';

interface PrefixItem {
  name: string;
  prefix: string;
}

interface ImageItem {
  key: string;
  name: string;
  size: number;
  sizeText: string;
  uploaded: string | null;
  uploadedText: string;
  contentType: string;
  extension: string;
  imageUrl: string;
  downloadUrl: string;
  markdown: string;
}

interface ListResponse {
  prefix: string;
  parentPrefix: string | null;
  prefixes: PrefixItem[];
  items: ImageItem[];
  sortBy: SortBy;
  sortOrder: SortOrder;
  count: number;
  totalSize: number;
  totalSizeText: string;
  limited: boolean;
  limitMessage: string | null;
  cursor?: string | null;
  truncated?: boolean;
  error?: string;
}

type NoticeType = 'info' | 'error' | 'success';

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required page element is missing: ${selector}`);
  }

  return element;
}

const searchInput = getElement<HTMLInputElement>('#searchInput');
const sortBySelect = getElement<HTMLSelectElement>('#sortBySelect');
const sortOrderSelect = getElement<HTMLSelectElement>('#sortOrderSelect');
const refreshButton = getElement<HTMLButtonElement>('#refreshButton');
const rootButton = getElement<HTMLButtonElement>('#rootButton');
const parentButton = getElement<HTMLButtonElement>('#parentButton');
const prefixList = getElement<HTMLDivElement>('#prefixList');
const currentPath = getElement<HTMLElement>('#currentPath');
const loadMoreButton = getElement<HTMLButtonElement>('#loadMoreButton');
const grid = getElement<HTMLDivElement>('#grid');
const notice = getElement<HTMLDivElement>('#notice');
const previewDialog = getElement<HTMLDialogElement>('#previewDialog');
const previewTitle = getElement<HTMLElement>('#previewTitle');
const previewImage = getElement<HTMLImageElement>('#previewImage');
const closePreviewButton = getElement<HTMLButtonElement>('#closePreviewButton');
const itemCount = getElement<HTMLElement>('#itemCount');
const totalSize = getElement<HTMLElement>('#totalSize');
const prefixBadge = getElement<HTMLElement>('#prefixBadge');

let loadedItems: ImageItem[] = [];
let currentPrefixes: PrefixItem[] = [];
let currentPrefix = '';
let parentPrefix: string | null = null;
let nextCursor: string | null = null;
let isLoading = false;
let currentAbortController: AbortController | null = null;
let noticeTimer: number | undefined;

function normalizePrefix(prefix: string): string {
  const cleanPrefix = prefix.trim().replace(/^\/+/, '');

  if (!cleanPrefix) {
    return '';
  }

  return cleanPrefix.endsWith('/') ? cleanPrefix : `${cleanPrefix}/`;
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

function formatDate(value: string | null, fallback = '未知时间'): string {
  if (!value) {
    return fallback || '未知时间';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback || '未知时间';
  }

  const pad = (part: number) => part.toString().padStart(2, '0');

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join(' ');
}

function showNotice(message: string, type: NoticeType = 'info', autoHide = type === 'success'): void {
  window.clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.dataset.type = type;
  notice.hidden = false;

  if (autoHide) {
    noticeTimer = window.setTimeout(hideNotice, 2600);
  }
}

function hideNotice(): void {
  window.clearTimeout(noticeTimer);
  notice.hidden = true;
  notice.textContent = '';
  delete notice.dataset.type;
}

function getCurrentPrefixLabel(): string {
  return currentPrefix || '根目录';
}

function getSortState(): { sortBy: SortBy; sortOrder: SortOrder } {
  const sortByValue = sortBySelect.value;
  const sortOrderValue = sortOrderSelect.value;
  const sortBy: SortBy = sortByValue === 'size' || sortByValue === 'name' ? sortByValue : 'uploaded';
  const sortOrder: SortOrder = sortOrderValue === 'asc' ? 'asc' : 'desc';

  return { sortBy, sortOrder };
}

function getFilteredItems(): ImageItem[] {
  const keyword = searchInput.value.trim().toLowerCase();

  if (!keyword) {
    return loadedItems;
  }

  return loadedItems.filter((item) => item.name.toLowerCase().includes(keyword) || item.key.toLowerCase().includes(keyword));
}

function getSizeText(item: ImageItem): string {
  return item.sizeText || formatBytes(item.size);
}

function getUploadedText(item: ImageItem): string {
  return formatDate(item.uploaded, item.uploadedText);
}

function updateStats(): void {
  const visibleItems = getFilteredItems();
  const visibleSize = visibleItems.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0);
  const prefixLabel = getCurrentPrefixLabel();

  itemCount.textContent = `${visibleItems.length}`;
  totalSize.textContent = formatBytes(visibleSize);
  prefixBadge.textContent = prefixLabel;
  currentPath.textContent = prefixLabel;
}

function renderDirectoryButtons(): void {
  if (currentPrefixes.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'prefix-empty';
    empty.textContent = '无子目录';
    prefixList.replaceChildren(empty);
    return;
  }

  const buttons = currentPrefixes.map((item) => {
    const button = document.createElement('button');
    button.className = 'directory-button';
    button.type = 'button';
    button.textContent = item.name;
    button.title = item.prefix;
    button.disabled = isLoading;
    button.addEventListener('click', () => navigateToPrefix(item.prefix));
    return button;
  });

  prefixList.replaceChildren(...buttons);
}

function updatePathButtons(): void {
  rootButton.disabled = isLoading || currentPrefix === '';
  parentButton.hidden = currentPrefix === '';
  parentButton.disabled = isLoading || currentPrefix === '';
}

async function copyMarkdown(markdown: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown);
    showNotice('Markdown 图片链接已复制。', 'success');
  } catch {
    showNotice('复制失败。请确认浏览器允许剪贴板权限，或手动复制链接。', 'error');
  }
}

function openPreview(item: ImageItem): void {
  previewTitle.textContent = item.name;
  previewImage.src = item.imageUrl;
  previewImage.alt = item.name;
  previewDialog.showModal();
}

function createMetaRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');

  term.textContent = label;
  description.textContent = value;
  row.append(term, description);

  return row;
}

function createCard(item: ImageItem): HTMLElement {
  const card = document.createElement('article');
  card.className = 'image-card';

  const previewButton = document.createElement('button');
  previewButton.className = 'preview-button';
  previewButton.type = 'button';
  previewButton.title = '打开大图预览';
  previewButton.addEventListener('click', () => openPreview(item));

  const image = document.createElement('img');
  image.src = item.imageUrl;
  image.alt = item.name;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    const fallback = document.createElement('div');
    fallback.className = 'broken-image';
    fallback.textContent = '预览失败';
    image.replaceWith(fallback);
  });

  const formatBadge = document.createElement('span');
  formatBadge.className = 'format-badge';
  formatBadge.textContent = item.extension ? item.extension.toUpperCase() : 'IMG';

  previewButton.append(image, formatBadge);

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h2');
  title.title = item.key;
  title.textContent = item.name;

  const keyLine = document.createElement('p');
  keyLine.className = 'key-line';
  keyLine.title = item.key;
  keyLine.textContent = item.key;

  const meta = document.createElement('dl');
  meta.className = 'meta';
  meta.append(
    createMetaRow('大小', getSizeText(item)),
    createMetaRow('创建时间', getUploadedText(item)),
    createMetaRow('文件类型', item.contentType || '未知类型')
  );

  const actions = document.createElement('div');
  actions.className = 'actions';

  const downloadLink = document.createElement('a');
  downloadLink.className = 'secondary-button';
  downloadLink.href = item.downloadUrl;
  downloadLink.textContent = '下载';
  downloadLink.title = '下载 R2 原图';

  const copyButton = document.createElement('button');
  copyButton.className = 'secondary-button';
  copyButton.type = 'button';
  copyButton.textContent = '复制';
  copyButton.title = '复制 Markdown 图片链接';
  copyButton.addEventListener('click', () => void copyMarkdown(item.markdown));

  actions.append(downloadLink, copyButton);
  body.append(title, keyLine, meta, actions);
  card.append(previewButton, body);

  return card;
}

function createEmptyState(message: string, descriptionText?: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';

  const title = document.createElement('strong');
  title.textContent = message;

  const description = document.createElement('span');
  description.textContent = descriptionText ?? '可以切换目录、刷新列表，或确认 PicGo 是否已经上传图片。';

  empty.append(title, description);
  return empty;
}

function createSkeletonCards(count = 8): HTMLElement[] {
  return Array.from({ length: count }, () => {
    const card = document.createElement('article');
    card.className = 'image-card skeleton-card';
    card.innerHTML = '<div class="skeleton-preview"></div><div class="skeleton-lines"><span></span><span></span><span></span></div>';
    return card;
  });
}

function render(): void {
  const items = getFilteredItems();
  updateStats();
  renderDirectoryButtons();
  updatePathButtons();

  loadMoreButton.hidden = !nextCursor;
  loadMoreButton.disabled = isLoading;
  loadMoreButton.textContent = isLoading ? '加载中...' : '加载更多';
  refreshButton.disabled = isLoading;
  sortBySelect.disabled = isLoading;
  sortOrderSelect.disabled = isLoading;

  if (isLoading && loadedItems.length === 0) {
    grid.replaceChildren(...createSkeletonCards());
    showNotice('正在加载图片列表...', 'info', false);
    return;
  }

  if (loadedItems.length === 0) {
    const description =
      currentPrefixes.length > 0 ? '当前目录没有直接图片，可以进入上方子目录查看。' : '可以切换目录、刷新列表，或确认 PicGo 是否已经上传图片。';
    grid.replaceChildren(createEmptyState('当前目录还没有图片', description));

    if (!notice.dataset.type || notice.dataset.type === 'info') {
      showNotice('当前 prefix 下没有可显示的图片。', 'info', false);
    }

    return;
  }

  if (items.length === 0) {
    grid.replaceChildren(createEmptyState('没有匹配搜索条件的图片'));

    if (!notice.dataset.type || notice.dataset.type === 'info') {
      showNotice('没有匹配搜索条件的图片。', 'info', false);
    }

    return;
  }

  grid.replaceChildren(...items.map(createCard));

  if (!notice.dataset.type || notice.dataset.type === 'info') {
    hideNotice();
  }
}

async function loadImages(reset = false): Promise<void> {
  if (isLoading && !reset) {
    return;
  }

  currentAbortController?.abort();
  const abortController = new AbortController();
  currentAbortController = abortController;

  if (reset) {
    loadedItems = [];
    currentPrefixes = [];
    nextCursor = null;
  }

  isLoading = true;
  render();

  const params = new URLSearchParams();
  const { sortBy, sortOrder } = getSortState();

  params.set('prefix', currentPrefix);
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);

  if (!reset && nextCursor) {
    params.set('cursor', nextCursor);
  }

  let loadError: string | null = null;
  let limitMessage: string | null = null;

  try {
    const response = await fetch(`/api/list?${params.toString()}`, {
      signal: abortController.signal
    });
    const data = (await response.json()) as ListResponse;

    if (!response.ok) {
      throw new Error(data.error ?? `请求失败：${response.status}`);
    }

    currentPrefix = normalizePrefix(data.prefix);
    parentPrefix = data.parentPrefix;
    currentPrefixes = data.prefixes;
    loadedItems = reset ? data.items : [...loadedItems, ...data.items];
    nextCursor = data.cursor ?? null;
    limitMessage = data.limitMessage;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    loadError = error instanceof Error ? error.message : '未知错误';
  } finally {
    if (currentAbortController !== abortController) {
      return;
    }

    isLoading = false;
    currentAbortController = null;
    render();

    if (loadError) {
      showNotice(`加载失败：${loadError}`, 'error', false);
    } else if (limitMessage) {
      showNotice(limitMessage, 'info', false);
    }
  }
}

function navigateToPrefix(prefix: string): void {
  currentPrefix = normalizePrefix(prefix);
  searchInput.value = '';
  void loadImages(true);
}

function debounce<T extends (...args: never[]) => void>(callback: T, delay = 160): T {
  let timer: number | undefined;

  return ((...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  }) as T;
}

rootButton.addEventListener('click', () => navigateToPrefix(''));
parentButton.addEventListener('click', () => {
  if (currentPrefix === '') {
    return;
  }

  navigateToPrefix(parentPrefix ?? '');
});

sortBySelect.addEventListener('change', () => void loadImages(true));
sortOrderSelect.addEventListener('change', () => void loadImages(true));
searchInput.addEventListener('input', debounce(render));
refreshButton.addEventListener('click', () => void loadImages(true));
loadMoreButton.addEventListener('click', () => void loadImages(false));

closePreviewButton.addEventListener('click', () => {
  previewDialog.close();
});

previewDialog.addEventListener('click', (event) => {
  if (event.target === previewDialog) {
    previewDialog.close();
  }
});

previewDialog.addEventListener('close', () => {
  previewImage.removeAttribute('src');
  previewImage.alt = '';
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    void loadImages(true);
  }
});

void loadImages(true);
