'use client';

// InsightOS - Analyst markdown renderer.
//
// The Insight Analyst asks providers for markdown (bold, inline code, lists,
// pipe tables, headings, --- separators) but the response card used to dump
// the raw string into a <div>, which collapsed newlines into an unreadable
// wall of text. This renders the small markdown subset the prompts request,
// using only the existing theme tokens - no markdown dependency, no HTML
// injection (everything goes through React text nodes).
//
// Two Analyst-specific callouts get first-class styling:
//   - paragraphs starting with "Grounding note:"    -> warning advisory box
//   - paragraphs starting with "General knowledge:" -> accent-tinted box

import * as React from 'react';

/** Inline tokens: **bold** and `code`. Everything else is a plain text node. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-elevated px-1 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'grounding-note'; text: string }
  | { kind: 'general-knowledge'; text: string };

const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Parse the markdown subset into blocks. Never throws; falls back to paragraphs. */
function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join(' ').trim();
    para = [];
    if (!joined) return;
    if (/^grounding note:/i.test(joined)) {
      blocks.push({ kind: 'grounding-note', text: joined.replace(/^grounding note:\s*/i, '') });
    } else if (/^general knowledge:/i.test(joined)) {
      blocks.push({ kind: 'general-knowledge', text: joined.replace(/^general knowledge:\s*/i, '') });
    } else {
      blocks.push({ kind: 'paragraph', text: joined });
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushPara();
      i += 1;
      continue;
    }

    const h = HEADING.exec(trimmed);
    if (h) {
      flushPara();
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      flushPara();
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (TABLE_ROW.test(trimmed)) {
      flushPara();
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) {
        const t = lines[i].trim();
        if (!TABLE_SEPARATOR.test(t)) rows.push(splitTableRow(t));
        i += 1;
      }
      if (rows.length > 0) blocks.push({ kind: 'table', rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushPara();
      const ordered = ORDERED_ITEM.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        items.push(lines[i].replace(LIST_ITEM, '').trim());
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    para.push(trimmed);
    i += 1;
  }
  flushPara();
  return blocks;
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className ?? 'space-y-3 text-sm leading-relaxed'}>
      {blocks.map((b, idx) => {
        const key = `blk-${idx}`;
        switch (b.kind) {
          case 'heading':
            return (
              <h5
                key={key}
                className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {renderInline(b.text, key)}
              </h5>
            );
          case 'rule':
            return <hr key={key} className="border-line" />;
          case 'list':
            return b.ordered ? (
              <ol key={key} className="list-decimal space-y-1.5 pl-5 marker:text-muted">
                {b.items.map((it, j) => (
                  <li key={`${key}-i${j}`}>{renderInline(it, `${key}-i${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-1.5 pl-5 marker:text-muted">
                {b.items.map((it, j) => (
                  <li key={`${key}-i${j}`}>{renderInline(it, `${key}-i${j}`)}</li>
                ))}
              </ul>
            );
          case 'table': {
            const [head, ...body] = b.rows;
            return (
              <div key={key} className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-elevated/60">
                      {head.map((c, j) => (
                        <th
                          key={`${key}-h${j}`}
                          className="px-3 py-2 font-semibold uppercase tracking-wide text-muted"
                        >
                          {renderInline(c, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((row, r) => (
                      <tr key={`${key}-r${r}`} className="border-b border-line/60 last:border-b-0">
                        {row.map((c, j) => (
                          <td key={`${key}-r${r}c${j}`} className="px-3 py-2 align-top">
                            {renderInline(c, `${key}-r${r}c${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'grounding-note':
            return (
              <aside
                key={key}
                className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed"
                aria-label="Grounding note"
              >
                <span className="font-semibold text-warning">Grounding note: </span>
                {renderInline(b.text, key)}
              </aside>
            );
          case 'general-knowledge':
            return (
              <aside
                key={key}
                className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs leading-relaxed"
                aria-label="General knowledge"
              >
                <span className="font-semibold text-accent">General knowledge: </span>
                {renderInline(b.text, key)}
              </aside>
            );
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
