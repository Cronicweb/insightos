/**
 * Remote URL helpers for the upload dialog.
 *
 * InsightOS has no backend, so a cross-origin fetch can only succeed when the
 * remote host opts in with CORS headers. We cannot proxy around that. What we
 * *can* do is:
 *
 *   1. rewrite the link shapes people actually paste (a GitHub "blob" page, a
 *      Google Sheets edit link) into the raw endpoints those same hosts serve
 *      with `access-control-allow-origin: *`, and
 *   2. tell the user precisely why a fetch failed instead of one catch-all
 *      sentence that blames CORS for offline, typo and 404 alike.
 *
 * This module is intentionally pure (no DOM, no engine imports) so it can be
 * unit tested and adds nothing to the ingest pipeline's weight.
 */

const SUPPORTED_EXTENSIONS = new Set([
  'csv',
  'tsv',
  'txt',
  'json',
  'ndjson',
  'jsonl',
  'parquet',
  'pq',
  'xlsx',
  'xlsm',
]);

const KNOWN_UNSUPPORTED: Record<string, string> = {
  pdf: 'a PDF document',
  doc: 'a Word document',
  docx: 'a Word document',
  ppt: 'a slide deck',
  pptx: 'a slide deck',
  zip: 'a zip archive',
  gz: 'a compressed archive',
  tgz: 'a compressed archive',
  rar: 'a compressed archive',
  '7z': 'a compressed archive',
  png: 'an image',
  jpg: 'an image',
  jpeg: 'an image',
  gif: 'an image',
  svg: 'an image',
  webp: 'an image',
  mp4: 'a video',
  mov: 'a video',
  html: 'a web page',
  htm: 'a web page',
};

export type UrlRewrite = {
  /** The URL that should actually be fetched. */
  url: string;
  /** True when it differs from what the user typed. */
  changed: boolean;
  /** Human explanation of the rewrite, present only when `changed`. */
  note?: string;
};

function extensionOf(rawUrl: string): string | null {
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    /* fall back to the raw string */
  }
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase();
}

/**
 * Rewrites well known "viewer" URLs to the raw, CORS-enabled endpoint the same
 * host serves. Anything we do not recognise is returned untouched — we never
 * guess at a host's raw URL scheme.
 */
export function normaliseDatasetUrl(raw: string): UrlRewrite {
  const trimmed = raw.trim();
  if (!trimmed) return { url: trimmed, changed: false };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: trimmed, changed: false };
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  const done = (url: string, note: string): UrlRewrite =>
    url === trimmed ? { url, changed: false } : { url, changed: true, note };

  // github.com/<owner>/<repo>/blob|raw/<ref>/<path> -> raw.githubusercontent.com
  if (host === 'github.com' || host === 'www.github.com') {
    const marker = segments[2];
    if ((marker === 'blob' || marker === 'raw') && segments.length > 4) {
      const rest = segments.slice(3).map(encodeURIComponent).join('/');
      return done(
        `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${rest}`,
        'GitHub file pages are HTML. Switched to raw.githubusercontent.com, which serves the file itself and allows cross-origin reads.',
      );
    }
  }

  // gist.github.com/<user>/<id> -> gist.githubusercontent.com/<user>/<id>/raw
  if (host === 'gist.github.com' && segments.length >= 2) {
    return done(
      `https://gist.githubusercontent.com/${segments[0]}/${segments[1]}/raw`,
      'Switched to the raw gist endpoint, which serves the file contents directly.',
    );
  }

  // gitlab.com/<group>/<repo>/-/blob/<ref>/<path> -> /-/raw/<ref>/<path>
  if (host.endsWith('gitlab.com') && parsed.pathname.includes('/-/blob/')) {
    return done(
      `${parsed.origin}${parsed.pathname.replace('/-/blob/', '/-/raw/')}${parsed.search}`,
      'Switched to the GitLab raw endpoint, which serves the file itself.',
    );
  }

  // bitbucket.org/<w>/<r>/src/<ref>/<path> -> /raw/<ref>/<path>
  if (host.endsWith('bitbucket.org') && parsed.pathname.includes('/src/')) {
    return done(
      `${parsed.origin}${parsed.pathname.replace('/src/', '/raw/')}${parsed.search}`,
      'Switched to the Bitbucket raw endpoint, which serves the file itself.',
    );
  }

  // huggingface.co/.../blob/... -> /resolve/...
  if (host.endsWith('huggingface.co') && parsed.pathname.includes('/blob/')) {
    return done(
      `${parsed.origin}${parsed.pathname.replace('/blob/', '/resolve/')}${parsed.search}`,
      'Switched to the Hugging Face resolve endpoint, which serves the file itself.',
    );
  }

  // Google Sheets: /spreadsheets/d/<id>/edit#gid=<n> -> /export?format=csv&gid=<n>
  if (host === 'docs.google.com' && segments[0] === 'spreadsheets' && segments[1] === 'd') {
    const id = segments[2];
    if (id) {
      const fromHash = /gid=(\d+)/.exec(parsed.hash);
      const gid = fromHash?.[1] ?? parsed.searchParams.get('gid') ?? '0';
      return done(
        `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
        'Switched to the Sheets CSV export endpoint. The sheet still has to be shared with "anyone with the link".',
      );
    }
  }

  // Google Drive: /file/d/<id>/view -> /uc?export=download&id=<id>
  if (host === 'drive.google.com') {
    const id = segments[0] === 'file' && segments[1] === 'd' ? segments[2] : parsed.searchParams.get('id');
    if (id) {
      return done(
        `https://drive.google.com/uc?export=download&id=${id}`,
        'Switched to the Drive direct-download endpoint. The file still has to be shared with "anyone with the link".',
      );
    }
  }

  // Dropbox share links -> dl.dropboxusercontent.com
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    const next = new URL(parsed.toString());
    next.hostname = 'dl.dropboxusercontent.com';
    next.searchParams.delete('dl');
    next.searchParams.delete('raw');
    return done(
      next.toString(),
      'Switched to the Dropbox direct-content host, which returns the file rather than the preview page.',
    );
  }

  // OneDrive / SharePoint share links need download=1
  if (host.endsWith('1drv.ms') || host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com')) {
    if (parsed.searchParams.get('download') !== '1') {
      const next = new URL(parsed.toString());
      next.searchParams.set('download', '1');
      return done(next.toString(), 'Added download=1 so the link returns the file instead of the viewer page.');
    }
  }

  return { url: trimmed, changed: false };
}

/**
 * Names the file type when the URL clearly points at something we cannot read,
 * so we can say so before spending a request. Returns null for supported
 * extensions and for URLs with no extension at all (an API endpoint, say).
 */
export function unsupportedExtensionMessage(url: string): string | null {
  const ext = extensionOf(url);
  if (!ext) return null;
  if (SUPPORTED_EXTENSIONS.has(ext)) return null;
  const label = KNOWN_UNSUPPORTED[ext];
  if (!label) return null;
  return `That link points at ${label} (.${ext}), not a dataset. InsightOS reads CSV, TSV, JSON, NDJSON, Parquet and Excel files.`;
}

export type FetchFailureKind = 'offline' | 'mixed-content' | 'cors' | 'unreachable';

export type FailureProbeDeps = {
  online: boolean;
  pageProtocol: string;
  /** Performs a no-cors request. Resolves if the host answered, rejects otherwise. */
  probe: (url: string) => Promise<unknown>;
};

/**
 * A blocked cross-origin read and a host that does not exist both surface as a
 * bare, message-less TypeError. A `no-cors` request is exempt from the CORS
 * check, so if that one resolves the host is alive and simply refused to share
 * its response; if it also throws, nothing answered at all. Two very different
 * fixes for the user. Costs one extra request, and only on the failure path.
 */
export async function classifyFetchFailure(
  target: string,
  deps: FailureProbeDeps,
): Promise<FetchFailureKind> {
  if (!deps.online) return 'offline';

  if (deps.pageProtocol === 'https:' && target.toLowerCase().startsWith('http://')) {
    return 'mixed-content';
  }

  try {
    await deps.probe(target);
    return 'cors';
  } catch {
    return 'unreachable';
  }
}

export function describeFetchFailure(kind: FetchFailureKind, target: string): string {
  let host = target;
  try {
    host = new URL(target).hostname;
  } catch {
    /* keep the raw string */
  }

  switch (kind) {
    case 'offline':
      return 'Your browser is offline, so the file could not be downloaded. Reconnect and try again, or use the File tab.';
    case 'mixed-content':
      return `InsightOS is served over HTTPS, so the browser blocks plain http:// downloads. Try the same link with https://, or download it and use the File tab.`;
    case 'cors':
      return `${host} answered, but it does not allow other sites to read its files (no CORS header). Only the host can change that — InsightOS has no backend to proxy through. Download the file and use the File tab instead.`;
    case 'unreachable':
    default:
      return `Nothing answered at ${host}. Check the address for a typo, or that the link is reachable without signing in.`;
  }
}

export function describeHttpStatus(status: number, statusText: string, target: string): string {
  let host = target;
  try {
    host = new URL(target).hostname;
  } catch {
    /* keep the raw string */
  }
  const suffix = statusText ? ` ${statusText}` : '';

  if (status === 401 || status === 403) {
    return `${host} refused the download (${status}${suffix}). The file is probably private — make it publicly readable, or download it and use the File tab.`;
  }
  if (status === 404) {
    return `${host} has no file at that path (404${suffix}). Check the link, including the branch or folder name.`;
  }
  if (status === 429) {
    return `${host} is rate limiting the download (429${suffix}). Wait a moment and try again.`;
  }
  if (status >= 500) {
    return `${host} returned a server error (${status}${suffix}). That is a problem on their end — try again later.`;
  }
  return `${host} returned ${status}${suffix} instead of the file.`;
}

/**
 * Catches the "200 OK but it is actually a sign-in page" case, which otherwise
 * fails much further downstream with a confusing parse error.
 */
export function htmlResponseMessage(head: string, target: string): string | null {
  const sniff = head.slice(0, 512).trimStart().toLowerCase();
  if (!sniff) return null;
  if (!sniff.startsWith('<!doctype html') && !sniff.startsWith('<html') && !sniff.startsWith('<?xml')) {
    return null;
  }
  let host = target;
  try {
    host = new URL(target).hostname;
  } catch {
    /* keep the raw string */
  }
  return `${host} returned a web page rather than a data file — usually a preview, sign-in or error page. Use the link that downloads the file directly.`;
}
