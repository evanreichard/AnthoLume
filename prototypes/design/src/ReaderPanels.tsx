import type { ReaderSession } from './DemoState';
import { chapterTitles } from './data';
import { Dialog } from './ui';

export type ReaderPanel = 'toc' | 'appearance' | null;
export function ReaderPanels({
  panel,
  session,
  onClose,
  onChapter,
  onChange,
  focusAfterToc,
}: {
  panel: ReaderPanel;
  session: ReaderSession;
  onClose: () => void;
  onChapter: (chapter: number) => void;
  onChange: (patch: Partial<ReaderSession>) => void;
  focusAfterToc: () => HTMLElement | null;
}) {
  if (panel === 'toc')
    return (
      <Dialog title="Table of contents" onClose={onClose} focusOnClose={focusAfterToc}>
        <p className="small muted">
          Four illustrative chapters reuse this original passage. No EPUB or activity engine is
          involved.
        </p>
        <ol className="toc-list">
          {chapterTitles.map((title, index) => (
            <li key={title}>
              <button
                aria-current={session.chapter === index ? 'location' : undefined}
                onClick={() => onChapter(index)}
              >
                <span>0{index + 1}</span>
                {title}
              </button>
            </li>
          ))}
        </ol>
      </Dialog>
    );
  if (panel !== 'appearance') return null;
  return (
    <Dialog title="Reading appearance" onClose={onClose}>
      <div className="stack">
        <label className="field">
          Typeface
          <select value={session.font} onChange={(event) => onChange({ font: event.target.value })}>
            <option value="serif">Literary · system serif</option>
            <option value="sans">Clear · system sans</option>
          </select>
        </label>
        <label className="field">
          Text size · {session.size}px
          <input
            type="range"
            min="16"
            max="28"
            value={session.size}
            onChange={(event) => onChange({ size: Number(event.target.value) })}
          />
        </label>
        <fieldset>
          <legend>Page appearance</legend>
          <div className="segmented">
            {[
              ['auto', 'Follow app'],
              ['paper', 'Paper'],
              ['ink', 'Ink'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={session.paper === value}
                onClick={() => onChange({ paper: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="small muted">
          Text is measured into real sample pages. Font, size and viewport changes keep the same
          word anchor, not the same page number. Preferences and position last until reload only.
        </p>
      </div>
    </Dialog>
  );
}
