import React, { useState, useRef, useEffect } from 'react';
import { StickyNote, Pencil, Trash2, Move, X } from 'lucide-react';
import { DiagramNotes, ContextMenuTarget, StateNodeInfo, EdgeInfo, NotePosition } from '../types.ts';
import { cleanNodeId, findNodeElement } from '../utils/nodeDragger.ts';

export interface NoteOverlaysLayerProps {
  notes: DiagramNotes;
  availableStates: StateNodeInfo[];
  availableEdges: EdgeInfo[];
  svgElement: SVGSVGElement | null;
  zoom: number;
  onEditNote: (target: ContextMenuTarget) => void;
  onDeleteNote: (target: ContextMenuTarget) => void;
  onUpdateNotePosition: (targetId: string, pos: NotePosition) => void;
  onSelectTarget?: (target: ContextMenuTarget) => void;
}

interface NoteItemWithPos {
  id: string; // target id (node id or edge id)
  type: 'node' | 'edge';
  text: string;
  label: string;
  x: number;
  y: number;
  targetAnchor: { x: number; y: number };
  targetObject: ContextMenuTarget;
}

export const NoteOverlaysLayer: React.FC<NoteOverlaysLayerProps> = ({
  notes,
  availableStates,
  availableEdges,
  svgElement,
  zoom,
  onEditNote,
  onDeleteNote,
  onUpdateNotePosition,
  onSelectTarget,
}) => {
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [selectedNoteCardId, setSelectedNoteCardId] = useState<string | null>(null);
  const [activeDragOffset, setActiveDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; origX: number; origY: number } | null>(null);

  // Compute positions for all node and edge notes
  const noteItems: NoteItemWithPos[] = [];

  // 1. Process Node Notes
  for (const [rawNodeId, text] of Object.entries(notes.nodes || {})) {
    if (!text || !text.trim()) continue;

    const nodeId = cleanNodeId(rawNodeId);
    const state = availableStates.find((s) => cleanNodeId(s.id) === nodeId || s.id === nodeId || s.id === rawNodeId);
    const label = state?.label || nodeId;

    let targetX = 150;
    let targetY = 150;
    let defaultNoteX = 230;
    let defaultNoteY = 105;

    if (svgElement) {
      const nodeEl =
        findNodeElement(svgElement, nodeId) ||
        findNodeElement(svgElement, rawNodeId) ||
        (svgElement.querySelector(
          `g.node[data-state-id="${nodeId}"], g.node[data-state-id="${rawNodeId}"], g.node#${nodeId}, g.node#${rawNodeId}`
        ) as SVGGElement | null);

      if (nodeEl) {
        const wrapperEl = (svgElement.closest('#mermaid-svg-wrapper') ||
          document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
        if (wrapperEl) {
          const wRect = wrapperEl.getBoundingClientRect();
          const nRect = nodeEl.getBoundingClientRect();
          if (wRect.width > 0 && nRect.width > 0) {
            const localLeft = (nRect.left - wRect.left) / zoom;
            const localTop = (nRect.top - wRect.top) / zoom;
            const localW = nRect.width / zoom;
            const localH = nRect.height / zoom;
            targetX = Math.round(localLeft + localW / 2);
            targetY = Math.round(localTop + localH / 2);
            defaultNoteX = Math.round(localLeft + localW + 28);
            defaultNoteY = Math.max(16, Math.round(localTop - 12));
          }
        } else {
          try {
            const bbox = nodeEl.getBBox();
            targetX = Math.round(bbox.x + bbox.width / 2);
            targetY = Math.round(bbox.y + bbox.height / 2);
            defaultNoteX = Math.round(bbox.x + bbox.width + 28);
            defaultNoteY = Math.max(16, Math.round(bbox.y - 12));
          } catch {
            // fallback
          }
        }
      }
    }

    const savedPos = notes.positions?.[rawNodeId] || notes.positions?.[nodeId];
    let noteX = savedPos ? savedPos.x : defaultNoteX;
    let noteY = savedPos ? savedPos.y : defaultNoteY;

    // Apply active drag override if currently dragging
    if (activeDragOffset && (activeDragOffset.id === rawNodeId || activeDragOffset.id === nodeId)) {
      noteX = activeDragOffset.x;
      noteY = activeDragOffset.y;
    }

    noteItems.push({
      id: rawNodeId,
      type: 'node',
      text,
      label: `State: ${label}`,
      x: noteX,
      y: noteY,
      targetAnchor: { x: targetX, y: targetY },
      targetObject: { type: 'node', id: rawNodeId, label, note: text },
    });
  }

  // 2. Process Edge Notes
  for (const [edgeId, text] of Object.entries(notes.edges || {})) {
    if (!text || !text.trim()) continue;

    const edge = availableEdges.find((e) => e.id === edgeId || `${e.from}->${e.to}` === edgeId);
    const label = edge?.label ? `${edge.from} → ${edge.to} (${edge.label})` : edge ? `${edge.from} → ${edge.to}` : edgeId;

    let targetX = 250;
    let targetY = 250;
    let defaultNoteX = 290;
    let defaultNoteY = 200;

    if (svgElement) {
      const pathEl = (svgElement.querySelector(
        `path.tc-edge-path[data-edge-id="${edgeId}"], g.edgePaths path[data-edge-id="${edgeId}"], g.edgePaths path[data-path-id="${edgeId}"]`
      ) ||
        (edge
          ? svgElement.querySelector(
              `path.tc-edge-path[data-source-id="${edge.from}"][data-target-id="${edge.to}"]`
            )
          : null)) as SVGPathElement | null;

      if (pathEl) {
        const wrapperEl = (svgElement.closest('#mermaid-svg-wrapper') ||
          document.getElementById('mermaid-svg-wrapper')) as HTMLElement | null;
        if (wrapperEl) {
          const wRect = wrapperEl.getBoundingClientRect();
          const pRect = pathEl.getBoundingClientRect();
          if (wRect.width > 0 && pRect.width > 0) {
            const localLeft = (pRect.left - wRect.left) / zoom;
            const localTop = (pRect.top - wRect.top) / zoom;
            const localW = pRect.width / zoom;
            const localH = pRect.height / zoom;
            targetX = Math.round(localLeft + localW / 2);
            targetY = Math.round(localTop + localH / 2);
            defaultNoteX = Math.round(targetX + 28);
            defaultNoteY = Math.max(16, Math.round(targetY - 32));
          }
        } else {
          try {
            const pathLen = pathEl.getTotalLength();
            const pt = pathEl.getPointAtLength(pathLen / 2);
            targetX = Math.round(pt.x);
            targetY = Math.round(pt.y);
            defaultNoteX = Math.round(targetX + 28);
            defaultNoteY = Math.max(16, Math.round(targetY - 32));
          } catch {
            // fallback
          }
        }
      }
    }

    const savedPos = notes.positions?.[edgeId];
    let noteX = savedPos ? savedPos.x : defaultNoteX;
    let noteY = savedPos ? savedPos.y : defaultNoteY;

    if (activeDragOffset && activeDragOffset.id === edgeId) {
      noteX = activeDragOffset.x;
      noteY = activeDragOffset.y;
    }

    noteItems.push({
      id: edgeId,
      type: 'edge',
      text,
      label: `Transition: ${label}`,
      x: noteX,
      y: noteY,
      targetAnchor: { x: targetX, y: targetY },
      targetObject: {
        type: 'edge',
        id: edgeId,
        from: edge?.from || '',
        to: edge?.to || '',
        label,
        note: text,
      },
    });
  }

  // Mouse drag handlers
  const handleNoteMouseDown = (e: React.MouseEvent, note: NoteItemWithPos) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      origX: note.x,
      origY: note.y,
    };
    setDraggingNoteId(note.id);
    setActiveDragOffset({ id: note.id, x: note.x, y: note.y });
  };

  useEffect(() => {
    if (!draggingNoteId) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
      const dy = (e.clientY - dragStartRef.current.clientY) / zoom;

      const newX = Math.round(dragStartRef.current.origX + dx);
      const newY = Math.round(dragStartRef.current.origY + dy);

      setActiveDragOffset({
        id: draggingNoteId,
        x: newX,
        y: newY,
      });
    };

    const handleWindowMouseUp = () => {
      if (activeDragOffset) {
        onUpdateNotePosition(activeDragOffset.id, {
          x: activeDragOffset.x,
          y: activeDragOffset.y,
        });
      }
      dragStartRef.current = null;
      setDraggingNoteId(null);
      setActiveDragOffset(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [draggingNoteId, activeDragOffset, onUpdateNotePosition, zoom]);

  if (noteItems.length === 0) {
    return null;
  }

  return (
    <div
      id="mermaid-note-overlays-layer"
      className="absolute inset-0 pointer-events-none z-20 overflow-visible"
      style={{ width: '100%', height: '100%' }}
    >
      {/* SVG Connector Lines from note cards to target anchors */}
      <svg
        className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <radialGradient id="note-anchor-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
        </defs>
        {noteItems.map((note) => {
          const cardCenterX = note.x + 100;
          const cardCenterY = note.y + 35;
          const targetX = note.targetAnchor.x;
          const targetY = note.targetAnchor.y;

          // Compute smooth curved or straight connector line
          const midX = (cardCenterX + targetX) / 2;
          const midY = (cardCenterY + targetY) / 2;

          return (
            <g key={`conn-${note.id}`} className="note-connector-group opacity-70 hover:opacity-100 transition-opacity">
              {/* Target anchor dot */}
              <circle
                cx={targetX}
                cy={targetY}
                r="7"
                fill="url(#note-anchor-glow)"
              />
              <circle
                cx={targetX}
                cy={targetY}
                r="3.5"
                fill="#f59e0b"
                stroke="#1e293b"
                strokeWidth="1.5"
              />
              {/* Connector path */}
              <path
                d={`M ${targetX} ${targetY} Q ${midX} ${targetY} ${cardCenterX} ${cardCenterY}`}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeDasharray="4 3"
              />
            </g>
          );
        })}
      </svg>

      {/* Note Overlay Cards */}
      {noteItems.map((note) => {
        const isDragging = draggingNoteId === note.id;

        return (
          <div
            key={note.id}
            id={`note-overlay-${note.id}`}
            style={{
              transform: `translate(${note.x}px, ${note.y}px)`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            className={`pointer-events-auto w-64 rounded-xl border shadow-xl backdrop-blur-md transition-all select-none ${
              isDragging
                ? 'shadow-2xl shadow-amber-500/20 border-amber-400 ring-2 ring-amber-400 scale-[1.02] cursor-grabbing z-30'
                : selectedNoteCardId === note.id
                ? 'bg-amber-50/95 dark:bg-slate-900/95 border-amber-400 ring-2 ring-amber-400/80 shadow-2xl z-25'
                : 'bg-amber-50/95 dark:bg-slate-900/95 border-amber-300 dark:border-amber-500/40 hover:border-amber-400 hover:shadow-2xl'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedNoteCardId(note.id);
              onSelectTarget?.(note.targetObject);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEditNote(note.targetObject);
            }}
          >
            {/* Active Selected Note Floating Action Bar / Title Bar */}
            {selectedNoteCardId === note.id && (
              <div
                id={`selected-note-toolbar-${note.id}`}
                className="absolute -top-11 left-0 right-0 flex items-center justify-between px-2.5 py-1.5 bg-slate-900/95 dark:bg-slate-900/95 border border-amber-500 rounded-lg shadow-2xl shadow-amber-500/20 backdrop-blur-md z-40"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center space-x-1.5 min-w-0 pr-2">
                  <StickyNote className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-amber-200 truncate">
                    {note.label}
                  </span>
                </div>
                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    id={`floating-edit-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onEditNote(note.targetObject);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-amber-200 hover:text-white bg-amber-500/20 hover:bg-amber-500/30 rounded border border-amber-500/40 transition-colors"
                    title="Edit Note"
                    aria-label="Edit Note"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                  <button
                    id={`floating-delete-note-${note.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onDeleteNote(note.targetObject);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-rose-300 hover:text-white bg-rose-500/20 hover:bg-rose-500/30 rounded border border-rose-500/40 transition-colors"
                    title="Delete Note"
                    aria-label="Delete Note"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNoteCardId(null);
                    }}
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                    title="Deselect Note"
                    aria-label="Deselect Note"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Card Header (Title Bar & Drag Handle) */}
            <div
              onMouseDown={(e) => handleNoteMouseDown(e, note)}
              className={`flex items-center justify-between px-3 py-2 rounded-t-xl border-b cursor-grab active:cursor-grabbing select-none transition-colors ${
                selectedNoteCardId === note.id
                  ? 'bg-amber-200 dark:bg-amber-950 border-amber-400 dark:border-amber-700/80 text-amber-950 dark:text-amber-100'
                  : 'bg-amber-200/90 dark:bg-amber-950/80 border-amber-300/80 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
              }`}
              title="Click & drag to reposition this note"
            >
              <div className="flex items-center space-x-1.5 min-w-0 pr-2">
                <StickyNote className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                <span className="text-[11px] font-bold text-amber-950 dark:text-amber-100 truncate">
                  {note.label}
                </span>
              </div>
              <div
                className="flex items-center space-x-1 shrink-0"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  id={`edit-note-${note.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onEditNote(note.targetObject);
                  }}
                  className="flex items-center gap-1 px-1.5 py-1 text-amber-950 dark:text-amber-100 hover:text-black dark:hover:text-white rounded hover:bg-amber-300/70 dark:hover:bg-amber-900/70 transition-colors text-[11px] font-medium"
                  title="Edit Note"
                  aria-label="Edit Note"
                >
                  <Pencil className="w-3 h-3" />
                  <span className="inline">Edit</span>
                </button>
                <button
                  id={`delete-note-${note.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onDeleteNote(note.targetObject);
                  }}
                  className="flex items-center gap-1 px-1.5 py-1 text-rose-800 dark:text-rose-300 hover:text-rose-950 dark:hover:text-rose-100 rounded hover:bg-rose-500/20 transition-colors text-[11px] font-medium"
                  title="Remove Note"
                  aria-label="Remove Note"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="inline">Delete</span>
                </button>
                <span className="text-amber-800/70 dark:text-amber-300/70 p-1 cursor-grab" title="Drag to move note">
                  <Move className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>

            {/* Note Content */}
            <div
              className="p-3 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto cursor-pointer"
              title="Double-click to edit note text"
            >
              {note.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};
