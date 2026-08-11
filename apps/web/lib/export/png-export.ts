/**
 * PNG export for anything the product draws.
 *
 * Charts are Recharts, which means they are live SVG in the DOM. Serialising
 * that SVG and painting it onto a canvas gives a pixel-accurate image with no
 * screenshot library and no extra bytes shipped to the visitor - the same
 * reasoning that made PDF the browser's own print pipeline rather than a
 * bundled renderer.
 *
 * Text nodes are the one trap: an <svg> lifted out of the page loses the
 * stylesheet that coloured it, so the computed fill/font of every painted node
 * is inlined before serialisation.
 */
import { downloadUrl, slug } from './report-export';

const INLINE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'opacity',
] as const;

function inlineStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const from = source.querySelectorAll('*');
  const to = clone.querySelectorAll('*');
  for (let i = 0; i < from.length && i < to.length; i += 1) {
    const computed = window.getComputedStyle(from[i]);
    const target = to[i] as SVGElement;
    let css = '';
    for (const prop of INLINE_PROPERTIES) {
      const value = computed.getPropertyValue(prop);
      if (value) css += `${prop}:${value};`;
    }
    if (css) target.setAttribute('style', css);
  }
}

export interface PngOptions {
  /** Pixel multiplier - 2 keeps the image sharp when pasted into a deck. */
  scale?: number;
  /** Painted behind the image, because SVG has no background of its own. */
  background?: string;
}

/** Serialise one SVG element to a PNG data URL. */
export async function svgToPngDataUrl(svg: SVGSVGElement, options: PngOptions = {}): Promise<string> {
  const scale = options.scale ?? 2;
  const background = options.background ?? '#ffffff';
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || Number(svg.getAttribute('width')) || 640));
  const height = Math.max(1, Math.round(rect.height || Number(svg.getAttribute('height')) || 360));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const markup = new XMLSerializer().serializeToString(clone);
  // A data URL avoids the tainted-canvas rules that a blob: URL can trip in
  // some browsers, and the markup is ours so there is nothing to leak.
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The chart could not be rendered to an image.'));
    image.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser does not support canvas export.');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * Export the first SVG inside `container` as a PNG download.
 *
 * Returns false when there is nothing drawable, so the caller can say so
 * instead of appearing to succeed silently.
 */
export async function downloadPng(
  container: HTMLElement | null,
  name: string,
  options?: PngOptions,
): Promise<boolean> {
  if (!container) return false;
  const svg = container.querySelector('svg');
  if (!svg) return false;
  const dataUrl = await svgToPngDataUrl(svg as SVGSVGElement, options);
  downloadUrl(`insightos-${slug(name)}-${new Date().toISOString().slice(0, 10)}.png`, dataUrl);
  return true;
}

/** Every chart on the page, one PNG per SVG. */
export async function downloadAllPng(container: HTMLElement | null, name: string): Promise<number> {
  if (!container) return 0;
  // Prefer the chart surfaces Recharts draws; only if a panel has none do we
  // fall back to any wide SVG, so an icon never lands in someone's deck.
  const charts = Array.from(container.querySelectorAll('svg.recharts-surface'));
  const svgs = (charts.length
    ? charts
    : Array.from(container.querySelectorAll('svg'))
  ).filter((s) => s.getBoundingClientRect().width > 80);
  let n = 0;
  for (const svg of svgs) {
    const dataUrl = await svgToPngDataUrl(svg as SVGSVGElement);
    downloadUrl(`insightos-${slug(name)}-chart-${n + 1}.png`, dataUrl);
    n += 1;
  }
  return n;
}
