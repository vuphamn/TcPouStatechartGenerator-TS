import React, { useEffect, useRef } from 'react';
import {
  StickyNote,
  Trash2,
  Palette,
  Copy,
  ExternalLink,
  X,
  Layers,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { ContextMenuTarget } from '../types.ts';

interface DiagramContextMenuProps {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onClose: () => void;
  onAddOrEditNote: (target: ContextMenuTarget) => void;
  onDeleteNote?: (target: ContextMenuTarget) => void;
  onOpenStyleCustomizer?: (nodeId: string) => void;
  onOpenMermaidLive?: () => void;
}

export const DiagramContextMenu: React.FC<DiagramContextMenuProps> = ({
  x,
  y,
  target,
  onClose,
  onAddOrEditNote,
  onDeleteNote,
  onOpenStyleCustomizer,
  onOpenMermaidLive,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copySuccess, setCopySuccess] = React.useState(false);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust menu position so it doesn't overflow viewport
  const menuWidth = 240;
  const menuHeight = 220;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 16);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 16);

  const hasNote = Boolean(target.type !== 'canvas' && target.note && target.note.trim());

  const handleCopy = () => {
    let textToCopy = '';
    if (target.type === 'node') {
      textToCopy = target.label || target.id;
    } else if (target.type === 'edge') {
      textToCopy = `${target.from} --> ${target.to}${target.label ? `: ${target.label}` : ''}`;
    }
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopySuccess(true);
      setTimeout(() => {
        setCopySuccess(false);
        onClose();
      }, 700);
    }
  };

  return (
    <div
      ref={menuRef}
      id="diagram-context-menu"
      style={{ left: `${Math.max(8, adjustedX)}px`, top: `${Math.max(8, adjustedY)}px` }}
      className="fixed z-50 w-60 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl p-1.5 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header Info */}
      <div className="px-2.5 py-2 mb-1 bg-slate-800/80 rounded-lg border border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          {target.type === 'node' && (
            <>
              <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <div className="truncate">
                <span className="font-semibold text-slate-100 block truncate text-[11.5px]">
                  {target.label || target.id}
                </span>
                <span className="text-[9.5px] text-sky-400 font-mono uppercase tracking-wider">
                  State Node
                </span>
              </div>
            </>
          )}
          {target.type === 'edge' && (
            <>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div className="truncate">
                <span className="font-semibold text-slate-100 block truncate text-[11.5px]">
                  {target.from} → {target.to}
                </span>
                <span className="text-[9.5px] text-amber-400 font-mono uppercase tracking-wider">
                  Transition Edge
                </span>
              </div>
            </>
          )}
          {target.type === 'canvas' && (
            <>
              <Sparkles className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-300">Diagram Canvas</span>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors"
          title="Close context menu"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Existing Note Preview if present */}
      {hasNote && (
        <div className="px-2.5 py-1.5 mb-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg text-amber-200/90 text-[11px] flex items-start gap-1.5">
          <StickyNote className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
          <p className="line-clamp-2 italic leading-tight">
            "{target.type !== 'canvas' ? target.note : ''}"
          </p>
        </div>
      )}

      {/* Menu Actions */}
      <div className="space-y-0.5">
        {target.type !== 'canvas' && (
          <>
            <button
              id="context-menu-add-note-btn"
              onClick={() => {
                onAddOrEditNote(target);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-sky-600/20 hover:text-sky-300 text-slate-200 transition-colors font-medium"
            >
              <StickyNote className="w-3.5 h-3.5 text-amber-400" />
              <span>{hasNote ? 'Edit note' : 'Add a note'}</span>
            </button>

            {hasNote && onDeleteNote && (
              <button
                id="context-menu-delete-note-btn"
                onClick={() => {
                  onDeleteNote(target);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-red-500/20 hover:text-red-300 text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove note</span>
              </button>
            )}

            {target.type === 'node' && onOpenStyleCustomizer && (
              <button
                id="context-menu-style-btn"
                onClick={() => {
                  onOpenStyleCustomizer(target.id);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
              >
                <Palette className="w-3.5 h-3.5 text-emerald-400" />
                <span>Customize Style...</span>
              </button>
            )}

            <button
              id="context-menu-copy-btn"
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>{copySuccess ? 'Copied!' : target.type === 'node' ? 'Copy state name' : 'Copy transition'}</span>
            </button>
          </>
        )}

        {onOpenMermaidLive && (
          <button
            id="context-menu-mermaid-live-btn"
            onClick={() => {
              onOpenMermaidLive();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
            <span>Open in mermaid.live</span>
          </button>
        )}
      </div>
    </div>
  );
};
