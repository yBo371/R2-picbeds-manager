import './style.css';

interface ImageItem {
  key: string;
  name: string;
  size: number;
  uploaded: string | null;
  imageUrl: string;
  downloadUrl: string;
  deleteUrl?: string;
  markdown: string;
}

interface ListResponse {
  items: ImageItem[];
  cursor: string | null;
  truncated: boolean;
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

const prefixSelect = getElement<HTMLSelectElement>('#prefixSelect');
const searchInput = getElement<HTMLInputElement>('#searchInput');
const refreshButton = getElement<HTMLButtonElement>('#refreshButton');
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
let nextCursor: string | null = null;
let isLoading = false;
let currentAbortController: AbortController | null = null;
let noticeTimer: number | undefined;

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return '未知时间';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
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
  return prefixSelect.value || '根目录';
}

function getFilteredItems(): ImageItem[] {
  const keyword = searchInput.value.trim().toLowerCase();

  if (!keyword) {
    return loadedItems;
  }

  return loadedItems.filter((item) => item.name.toLowerCase().includes(keyword) || item.key.toLowerCase().includes(keyword));
}

function updateStats(): void {
  const visibleItems = getFilteredItems();
  const visibleSize = visibleItems.reduce((sum, item) => sum + item.size, 0);

  itemCount.textContent = `${visibleItems.length}`;
  totalSize.textContent = formatBytes(visibleSize);
  prefixBadge.textContent = getCurrentPrefixLabel();
}

async function copyMarkdown(markdown: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown);
    showNotice('Markdown 图片链接已复制。', 'success');
  } catch {
    showNotice('复制失败。请确认浏览器允许剪贴板权限，或手动复制链接。', 'error');
  }
}

async function deleteImage(item: ImageItem): Promise<void> {
  const confirmed = window.confirm(`确定要删除 "${item.name}" 吗？这个操作会删除 R2 原始文件。`);

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(item.deleteUrl ?? `/delete/${encodeKeyPath(item.key)}`, { method: 'DELETE' });
    const data = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? `删除失败：${response.status}`);
    }

    loadedItems = loadedItems.filter((loadedItem) => loadedItem.key !== item.key);
    showNotice('图片已删除。', 'success');
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    showNotice(`删除失败：${message}`, 'error');
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
  formatBadge.textContent = item.name.split('.').pop()?.toUpperCase() ?? 'IMG';

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
  meta.append(createMetaRow('大小', formatBytes(item.size)), createMetaRow('时间', formatDate(item.uploaded)));

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

  const deleteButton = document.createElement('button');
  deleteButton.className = 'danger-button';
  deleteButton.type = 'button';
  deleteButton.textContent = '删除';
  deleteButton.title = '删除 R2 原图';
  deleteButton.addEventListener('click', () => void deleteImage(item));

  actions.append(downloadLink, copyButton, deleteButton);
  body.append(title, keyLine, meta, actions);
  card.append(previewButton, body);

  return card;
}

function createEmptyState(message: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';

  const title = document.createElement('strong');
  title.textContent = message;

  const description = document.createElement('span');
  description.textContent = '可以切换目录、刷新列表，或确认 PicGo 是否已经上传图片。';

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

  loadMoreButton.hidden = !nextCursor && !isLoading;
  loadMoreButton.disabled = isLoading;
  loadMoreButton.textContent = isLoading ? '加载中...' : '加载更多';
  refreshButton.disabled = isLoading;

  if (isLoading && loadedItems.length === 0) {
    grid.replaceChildren(...createSkeletonCards());
    showNotice('正在加载图片列表...', 'info', false);
    return;
  }

  if (loadedItems.length === 0) {
    grid.replaceChildren(createEmptyState('当前目录还没有图片'));
    showNotice('当前 prefix 下没有可显示的图片。', 'info', false);
    return;
  }

  if (items.length === 0) {
    grid.replaceChildren(createEmptyState('没有匹配搜索条件的图片'));
    showNotice('没有匹配搜索条件的图片。', 'info', false);
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
  currentAbortController = new AbortController();

  if (reset) {
    loadedItems = [];
    nextCursor = null;
  }

  isLoading = true;
  render();

  const params = new URLSearchParams();
  params.set('prefix', prefixSelect.value);

  if (!reset && nextCursor) {
    params.set('cursor', nextCursor);
  }

  try {
    const response = await fetch(`/api/list?${params.toString()}`, {
      signal: currentAbortController.signal
    });
    const data = (await response.json()) as ListResponse;

    if (!response.ok) {
      throw new Error(data.error ?? `请求失败：${response.status}`);
    }

    loadedItems = reset ? data.items : [...loadedItems, ...data.items];
    nextCursor = data.cursor;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    const message = error instanceof Error ? error.message : '未知错误';
    showNotice(`加载失败：${message}`, 'error', false);
  } finally {
    isLoading = false;
    currentAbortController = null;
    render();
  }
}

function debounce<T extends (...args: never[]) => void>(callback: T, delay = 160): T {
  let timer: number | undefined;

  return ((...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  }) as T;
}

prefixSelect.addEventListener('change', () => {
  searchInput.value = '';
  void loadImages(true);
});

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
