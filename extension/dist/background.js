'use strict';
// Docs & Data extension service worker:
//  • file:// links to supported files and folders open in the viewer instead of Chrome's plain view
//  • right-click a link → "Open in Docs & Data"
//  • finished downloads of supported files offer to open them
const VIEWER = chrome.runtime.getURL('index.html');
// shown by the viewer when opened from a file:// address (Chrome shows PDFs, images, video and HTML well itself)
const TAKE = new Set(['csv', 'tsv', 'tab', 'xlsx', 'jsonl', 'ndjson', 'docx', 'json', 'geojson', 'md', 'markdown', 'yaml', 'yml', 'xml', 'srt', 'vtt', 'log']);
// offered after a download
const OFFER = new Set([...TAKE, 'pdf', 'txt', 'mp4', 'webm', 'mov', 'mkv', 'mp3', 'm4a']);

const extOf = url => (/\.([^./?#]+)(?:[?#]|$)/.exec(url)?.[1] || '').toLowerCase();
const viewerURL = (param, url) => `${VIEWER}?${param}=${encodeURIComponent(url)}`;
const fileURLOf = path => 'file://' + (path.startsWith('/') ? '' : '/') + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
const nameOf = p => decodeURIComponent(p.split(/[\\/]/).filter(Boolean).pop() || p);

async function prefs() {
  const p = await chrome.storage.local.get({ folders: true, downloads: true });
  return p;
}

// ---------------------------------------------------------------- menus
chrome.runtime.onInstalled.addListener(async () => {
  const p = await prefs();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'link', title: 'Open link in Docs & Data', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'page', title: 'Open this page’s file in Docs & Data', contexts: ['page'], documentUrlPatterns: ['file:///*'] });
    chrome.contextMenus.create({ id: 'folders', title: 'Open file:// folders in Docs & Data', type: 'checkbox', checked: p.folders, contexts: ['action'] });
    chrome.contextMenus.create({ id: 'downloads', title: 'Offer to open finished downloads', type: 'checkbox', checked: p.downloads, contexts: ['action'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'folders' || info.menuItemId === 'downloads') {
    chrome.storage.local.set({ [info.menuItemId]: info.checked });
    return;
  }
  const url = info.menuItemId === 'link' ? info.linkUrl : info.pageUrl;
  if (!url) return;
  chrome.tabs.create({ url: viewerURL(url.startsWith('file:') ? 'open' : 'url', url), index: tab ? tab.index + 1 : undefined });
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: VIEWER }));

// ---------------------------------------------------------------- file:// links
const recent = new Map(); // url → time redirected (so the matching download isn't opened twice)
chrome.webNavigation.onBeforeNavigate.addListener(async d => {
  if (d.frameId !== 0) return;
  const isFolder = d.url.endsWith('/');
  if (isFolder ? !(await prefs()).folders : !TAKE.has(extOf(d.url))) return;
  recent.set(d.url, Date.now());
  chrome.tabs.update(d.tabId, { url: viewerURL('open', d.url) });
}, { url: [{ schemes: ['file'] }] });

// .xlsx / .docx from file:// start a download in Chrome instead of a page: cancel it, the viewer shows the file
chrome.downloads.onCreated.addListener(item => {
  const url = item.finalUrl || item.url;
  if (!url.startsWith('file:') || !TAKE.has(extOf(url))) return;
  chrome.downloads.cancel(item.id, () => chrome.downloads.erase({ id: item.id }));
  if (Date.now() - (recent.get(url) || 0) > 5000) chrome.tabs.create({ url: viewerURL('open', url) });
});

// ---------------------------------------------------------------- finished downloads
chrome.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== 'complete' || !(await prefs()).downloads) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item?.filename || !OFFER.has(extOf(item.filename)) || item.byExtensionId === chrome.runtime.id) return;
  chrome.notifications.create('dl:' + item.id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Download finished',
    message: `Open ${nameOf(item.filename)} in Docs & Data?`,
    buttons: [{ title: 'Open' }],
    priority: 0,
  });
});

async function openDownload(id) {
  if (!id.startsWith('dl:')) return;
  chrome.notifications.clear(id);
  const [item] = await chrome.downloads.search({ id: +id.slice(3) });
  if (item?.filename) chrome.tabs.create({ url: viewerURL('open', fileURLOf(item.filename)) });
}
chrome.notifications.onClicked.addListener(openDownload);
chrome.notifications.onButtonClicked.addListener(openDownload);
