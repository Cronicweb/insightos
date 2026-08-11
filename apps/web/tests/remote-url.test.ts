import { describe, expect, it } from 'vitest';

import {
  classifyFetchFailure,
  describeFetchFailure,
  describeHttpStatus,
  htmlResponseMessage,
  normaliseDatasetUrl,
  unsupportedExtensionMessage,
} from '@/lib/ingest/remote-url';

describe('normaliseDatasetUrl', () => {
  it('rewrites a GitHub blob page to raw.githubusercontent.com', () => {
    const result = normaliseDatasetUrl('https://github.com/vega/vega-datasets/blob/main/data/cars.json');
    expect(result.changed).toBe(true);
    expect(result.url).toBe('https://raw.githubusercontent.com/vega/vega-datasets/main/data/cars.json');
    expect(result.note).toMatch(/raw\.githubusercontent/);
  });

  it('rewrites a GitHub raw page URL too', () => {
    const result = normaliseDatasetUrl('https://github.com/o/r/raw/main/data/x.csv');
    expect(result.url).toBe('https://raw.githubusercontent.com/o/r/main/data/x.csv');
  });

  it('leaves an already raw GitHub URL alone', () => {
    const url = 'https://raw.githubusercontent.com/o/r/main/data/x.csv';
    expect(normaliseDatasetUrl(url)).toEqual({ url, changed: false });
  });

  it('rewrites a gist URL to its raw endpoint', () => {
    const result = normaliseDatasetUrl('https://gist.github.com/someone/abc123');
    expect(result.url).toBe('https://gist.githubusercontent.com/someone/abc123/raw');
  });

  it('rewrites a GitLab blob URL', () => {
    const result = normaliseDatasetUrl('https://gitlab.com/group/repo/-/blob/main/data.csv');
    expect(result.url).toBe('https://gitlab.com/group/repo/-/raw/main/data.csv');
  });

  it('rewrites a Bitbucket src URL', () => {
    const result = normaliseDatasetUrl('https://bitbucket.org/team/repo/src/main/data.csv');
    expect(result.url).toBe('https://bitbucket.org/team/repo/raw/main/data.csv');
  });

  it('rewrites a Hugging Face blob URL', () => {
    const result = normaliseDatasetUrl('https://huggingface.co/datasets/x/y/blob/main/train.parquet');
    expect(result.url).toBe('https://huggingface.co/datasets/x/y/resolve/main/train.parquet');
  });

  it('rewrites a Google Sheets edit link, keeping the gid from the hash', () => {
    const result = normaliseDatasetUrl('https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=456');
    expect(result.url).toBe('https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=456');
  });

  it('defaults the Sheets gid to 0 when absent', () => {
    const result = normaliseDatasetUrl('https://docs.google.com/spreadsheets/d/SHEET_ID/edit');
    expect(result.url).toContain('gid=0');
  });

  it('rewrites a Google Drive view link to a direct download', () => {
    const result = normaliseDatasetUrl('https://drive.google.com/file/d/FILE_ID/view?usp=sharing');
    expect(result.url).toBe('https://drive.google.com/uc?export=download&id=FILE_ID');
  });

  it('rewrites a Dropbox share link to the direct content host', () => {
    const result = normaliseDatasetUrl('https://www.dropbox.com/s/abc/data.csv?dl=0');
    expect(result.url).toContain('dl.dropboxusercontent.com');
    expect(result.url).not.toContain('dl=0');
  });

  it('adds download=1 to a OneDrive link', () => {
    const result = normaliseDatasetUrl('https://1drv.ms/x/s!AbCdEf');
    expect(result.url).toContain('download=1');
  });

  it('leaves an unknown host untouched', () => {
    const url = 'https://example.org/data/sales.csv';
    expect(normaliseDatasetUrl(url)).toEqual({ url, changed: false });
  });

  it('leaves a non-URL string untouched', () => {
    expect(normaliseDatasetUrl('not a url')).toEqual({ url: 'not a url', changed: false });
  });
});

describe('unsupportedExtensionMessage', () => {
  it('names a PDF', () => {
    const message = unsupportedExtensionMessage('https://x.test/MCA%20203%20Unit%201.pdf');
    expect(message).toMatch(/PDF document/);
    expect(message).toMatch(/CSV/);
  });

  it('accepts a supported extension', () => {
    expect(unsupportedExtensionMessage('https://x.test/data.csv')).toBeNull();
  });

  it('accepts an extensionless endpoint', () => {
    expect(unsupportedExtensionMessage('https://x.test/api/v1/records')).toBeNull();
  });
});

describe('classifyFetchFailure', () => {
  const online = { online: true, pageProtocol: 'https:', probe: async () => undefined };

  it('detects an offline browser first', async () => {
    const kind = await classifyFetchFailure('https://x.test/a.csv', { ...online, online: false });
    expect(kind).toBe('offline');
  });

  it('detects mixed content', async () => {
    const kind = await classifyFetchFailure('http://x.test/a.csv', online);
    expect(kind).toBe('mixed-content');
  });

  it('reports cors when the no-cors probe succeeds', async () => {
    const kind = await classifyFetchFailure('https://x.test/a.csv', online);
    expect(kind).toBe('cors');
  });

  it('reports unreachable when the no-cors probe also fails', async () => {
    const kind = await classifyFetchFailure('https://x.test/a.csv', {
      ...online,
      probe: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(kind).toBe('unreachable');
  });

  it('produces distinct copy per cause', () => {
    const messages = new Set(
      (['offline', 'mixed-content', 'cors', 'unreachable'] as const).map((kind) =>
        describeFetchFailure(kind, 'https://x.test/a.csv'),
      ),
    );
    expect(messages.size).toBe(4);
  });
});

describe('describeHttpStatus', () => {
  it('explains a 403 as a private file', () => {
    expect(describeHttpStatus(403, 'Forbidden', 'https://x.test/a.csv')).toMatch(/private/);
  });

  it('explains a 404 as a wrong path', () => {
    expect(describeHttpStatus(404, 'Not Found', 'https://x.test/a.csv')).toMatch(/no file at that path/);
  });

  it('explains a 500 as their problem', () => {
    expect(describeHttpStatus(500, 'Internal Server Error', 'https://x.test/a.csv')).toMatch(/server error/);
  });

  it('falls back for an unusual status', () => {
    expect(describeHttpStatus(418, "I'm a teapot", 'https://x.test/a.csv')).toMatch(/418/);
  });
});

describe('htmlResponseMessage', () => {
  it('flags an HTML document', () => {
    expect(htmlResponseMessage('<!DOCTYPE html><html><body>Sign in', 'https://x.test/a.csv')).toMatch(
      /web page/,
    );
  });

  it('flags a bare <html> start', () => {
    expect(htmlResponseMessage('<html lang="en">', 'https://x.test/a.csv')).toMatch(/web page/);
  });

  it('ignores CSV content', () => {
    expect(htmlResponseMessage('id,name\n1,a', 'https://x.test/a.csv')).toBeNull();
  });

  it('ignores empty content', () => {
    expect(htmlResponseMessage('', 'https://x.test/a.csv')).toBeNull();
  });
});
