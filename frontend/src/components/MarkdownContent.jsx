import React from 'react';
import { TriangleAlert, CheckCircle2, ShieldAlert } from 'lucide-react';

/**
 * Parses inline formatting: **bold**, *italic*, `code`, and [G1] badges
 */
function parseInline(text) {
  if (!text) return null;

  // Split by inline markdown tokens
  const parts = [];
  let remaining = text;
  let keyIndex = 0;

  // Regex for **bold**, *italic*, `code`, and [G1]/[R1] badges
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[G|R]\d+\])/g;

  let match;
  let lastIndex = 0;

  while ((match = tokenRegex.exec(remaining)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(remaining.substring(lastIndex, match.index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
      parts.push(
        <strong key={keyIndex++} className="font-bold text-slate-900 dark:text-slate-100">
          {matchedStr.slice(2, -2)}
        </strong>
      );
    } else if (matchedStr.startsWith('*') && matchedStr.endsWith('*')) {
      parts.push(
        <em key={keyIndex++} className="italic text-slate-700 dark:text-slate-300">
          {matchedStr.slice(1, -1)}
        </em>
      );
    } else if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      parts.push(
        <code key={keyIndex++} className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 border border-slate-200 dark:border-slate-700">
          {matchedStr.slice(1, -1)}
        </code>
      );
    } else if (/^\[[G|R]\d+\]$/.test(matchedStr)) {
      parts.push(
        <span key={keyIndex++} className="inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 mx-1">
          {matchedStr}
        </span>
      );
    }

    lastIndex = match.index + matchedStr.length;
  }

  if (lastIndex < remaining.length) {
    parts.push(remaining.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export default function MarkdownContent({ content, className = '' }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let currentList = [];
  let elementIndex = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${elementIndex++}`} className="space-y-1 my-1">
          {currentList.map((item, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-200 leading-snug">
              <span className="text-red-500 dark:text-red-400 font-bold shrink-0 mt-0.5">•</span>
              <span className="flex-1">{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // 1. Bullet list item (•, -, *, 1.)
    if (/^[•\-\*]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[•\-\*]\s+/, '');
      currentList.push(itemText);
      continue;
    }

    // Numbered item: 1. , 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+\.\s+/, '');
      currentList.push(itemText);
      continue;
    }

    // Not a list item, flush any list in progress
    flushList();

    // 2. Critical warning or precaution
    if (
      trimmed.startsWith('⚠️') ||
      trimmed.toLowerCase().includes('precaution:') ||
      trimmed.toLowerCase().includes('warning:')
    ) {
      elements.push(
        <div
          key={`warn-${elementIndex++}`}
          className="my-1.5 p-2 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-[11px] font-medium flex items-start gap-2 shadow-xs"
        >
          <TriangleAlert size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 leading-snug">
            {parseInline(trimmed.replace(/^⚠️\s*/, ''))}
          </div>
        </div>
      );
      continue;
    }

    // 3. Headings: ### Heading, or **Bold Heading:** on single line
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${elementIndex++}`} className="text-xs sm:text-[13px] font-extrabold text-slate-900 dark:text-slate-100 mt-2 mb-1 flex items-center gap-1.5">
          {parseInline(trimmed.replace(/^###\s+/, ''))}
        </h4>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${elementIndex++}`} className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 mt-2 mb-1">
          {parseInline(trimmed.replace(/^##\s+/, ''))}
        </h3>
      );
      continue;
    }

    // Check if whole line is **Heading text**
    if (/^\*\*[^*]+\*\*$/.test(trimmed) || /^\*\*[^*]+:\*\*$/.test(trimmed)) {
      elements.push(
        <h4 key={`bh-${elementIndex++}`} className="text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-slate-100 mt-2 mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          <span>{trimmed.replace(/\*\*/g, '')}</span>
        </h4>
      );
      continue;
    }

    // 4. Regular paragraph
    elements.push(
      <p key={`p-${elementIndex++}`} className="text-xs text-slate-700 dark:text-slate-200 leading-snug mb-1.5">
        {parseInline(trimmed)}
      </p>
    );
  }

  flushList();

  return <div className={`space-y-0.5 ${className}`}>{elements}</div>;
}
