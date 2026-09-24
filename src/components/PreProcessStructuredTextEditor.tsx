<<<<<<< HEAD
import React from 'react';
import { MethodStructuredTextEditor, MethodStructuredTextEditorProps } from './MethodStructuredTextEditor.tsx';
=======
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Code2,
  Save,
  RotateCcw,
  Copy,
  Check,
  ArrowRight,
  AlertCircle,
  FileCode,
  Sparkles,
  Maximize2,
  Minimize2,
  CheckCircle2,
  X,
  Layers,
  ChevronDown,
  ChevronRight,
  GripHorizontal,
} from 'lucide-react';
import {
  getPreProcessCodeFromPou,
  parseTransitionsFromStateCode,
  ExtractedPreProcessCode,
} from '../utils/pouStateEditor.ts';
>>>>>>> 6743ef0ad9a3d2bf2f03684fb34e4c0fe64f9323

export interface PreProcessStructuredTextEditorProps {
  tcPouContent?: string;
  tcPouFileName?: string;
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onClose?: () => void;
  isModal?: boolean;
  onJumpToState?: (stateId: string) => void;
}

<<<<<<< HEAD
export const PreProcessStructuredTextEditor: React.FC<PreProcessStructuredTextEditorProps> = (props) => {
  return <MethodStructuredTextEditor {...props} initialMethod="preProcess" />;
=======
export const PreProcessStructuredTextEditor: React.FC<PreProcessStructuredTextEditorProps> = ({
  tcPouContent = '',
  tcPouFileName = 'POU.TcPOU',
  onSavePreProcessCode,
  onClose,
  isModal = false,
  onJumpToState,
}) => {
  // Extract initial code for preProcess()
  const extractedInfo = useMemo<ExtractedPreProcessCode>(() => {
    return getPreProcessCodeFromPou(tcPouContent);
  }, [tcPouContent]);

  const [code, setCode] = useState<string>('');
  const [initialCode, setInitialCode] = useState<string>('');
  const [declaration, setDeclaration] = useState<string>('');
  const [initialDeclaration, setInitialDeclaration] = useState<string>('');
  const [showDeclaration, setShowDeclaration] = useState<boolean>(true);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({
    type: 'idle',
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const declTextareaRef = useRef<HTMLTextAreaElement>(null);
  const declLineNumbersRef = useRef<HTMLDivElement>(null);

  // Panel splitter ratio: 20% Top Panel (Declaration), 80% Bottom Panel (Implementation) initially
  const [splitRatio, setSplitRatio] = useState<number>(0.2);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Dragging event handlers for the panel splitter
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);
  };

  const handleSplitterTouchStart = () => {
    setIsDraggingSplitter(true);
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offsetY = e.clientY - rect.top;
      // Clamp between 8% and 85% to ensure headers and content stay accessible
      const newRatio = Math.max(0.08, Math.min(0.85, offsetY / rect.height));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!splitContainerRef.current || !e.touches[0]) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offsetY = e.touches[0].clientY - rect.top;
      const newRatio = Math.max(0.08, Math.min(0.85, offsetY / rect.height));
      setSplitRatio(newRatio);
    };

    const handleTouchEnd = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingSplitter]);

  // When pouContent changes, load code
  useEffect(() => {
    const loadedCode = extractedInfo.code || '';
    const loadedDecl = extractedInfo.declaration || '';
    setCode(loadedCode);
    setInitialCode(loadedCode);
    setDeclaration(loadedDecl);
    setInitialDeclaration(loadedDecl);
    setSaveStatus({ type: 'idle' });
  }, [extractedInfo]);

  const isDirty = code !== initialCode || declaration !== initialDeclaration;

  // Real-time parsed transitions from current code
  const currentTransitions = useMemo(() => {
    return parseTransitionsFromStateCode(code, extractedInfo.stateVarName || 'machineState');
  }, [code, extractedInfo.stateVarName]);

  // Sync scroll between textarea and line numbers gutter for ST code
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Sync scroll between textarea and line numbers gutter for Declaration
  const handleDeclScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (declLineNumbersRef.current) {
      declLineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Handle Tab key for proper indentation in ST code
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (e.shiftKey) {
        // Shift+Tab: Unindent current line
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        if (val.slice(lineStart, lineStart + 1) === '\t') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 1);
          setCode(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 1);
            textarea.selectionEnd = Math.max(lineStart, end - 1);
          }, 0);
        } else if (val.slice(lineStart, lineStart + 2) === '  ') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
          setCode(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          }, 0);
        }
      } else {
        // Tab: Insert tab character
        const insertText = '\t';
        const nextVal = val.substring(0, start) + insertText + val.substring(end);
        setCode(nextVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
        }, 0);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Ctrl+S / Cmd+S save
      e.preventDefault();
      handleSave();
    }
  };

  // Handle Tab key for proper indentation in Declaration
  const handleDeclKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = declTextareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (e.shiftKey) {
        // Shift+Tab: Unindent current line
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        if (val.slice(lineStart, lineStart + 1) === '\t') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 1);
          setDeclaration(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 1);
            textarea.selectionEnd = Math.max(lineStart, end - 1);
          }, 0);
        } else if (val.slice(lineStart, lineStart + 2) === '  ') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
          setDeclaration(nextVal);
          setTimeout(() => {
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          }, 0);
        }
      } else {
        // Tab: Insert tab character
        const insertText = '\t';
        const nextVal = val.substring(0, start) + insertText + val.substring(end);
        setDeclaration(nextVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
        }, 0);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Ctrl+S / Cmd+S save
      e.preventDefault();
      handleSave();
    }
  };

  const handleSave = () => {
    if (!onSavePreProcessCode) {
      setSaveStatus({
        type: 'error',
        message: 'Save handler is not connected.',
      });
      return;
    }

    setSaveStatus({ type: 'idle' });
    const res = onSavePreProcessCode(code, declaration);
    if (res.success) {
      setInitialCode(code);
      setInitialDeclaration(declaration);
      setSaveStatus({
        type: 'success',
        message: 'Saved preProcess() to .TcPOU and refreshed diagram drawings!',
      });
      setTimeout(() => {
        setSaveStatus((prev) => (prev.type === 'success' ? { type: 'idle' } : prev));
      }, 4000);
    } else {
      setSaveStatus({
        type: 'error',
        message: res.error || 'Failed to update preProcess() in .TcPOU',
      });
    }
  };

  const handleReset = () => {
    setCode(initialCode);
    setDeclaration(initialDeclaration);
    setSaveStatus({ type: 'idle' });
  };

  const handleCopy = async () => {
    try {
      const fullText = declaration ? `// === DECLARATION ===\n${declaration}\n\n// === IMPLEMENTATION ===\n${code}` : code;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Generate line numbers for ST implementation code
  const lines = useMemo(() => {
    const count = (code.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 1) }, (_, i) => i + 1);
  }, [code]);

  // Generate line numbers for Declaration (top panel) to show all available lines
  const declLines = useMemo(() => {
    const count = (declaration.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 1) }, (_, i) => i + 1);
  }, [declaration]);

  const declLineCount = declLines.length;

  const editorContent = (
    <div
      id="preprocess-st-editor-panel"
      className={`flex flex-col bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden transition-all duration-200 ${
        isExpanded
          ? 'fixed inset-4 z-[110] max-w-none max-h-none'
          : isModal
          ? 'relative w-full max-w-4xl max-h-[85vh]'
          : 'w-full flex-1 min-h-0'
      }`}
    >
      {/* Editor Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center shrink-0">
            <FileCode className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 font-mono">
                preProcess()
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
                METHOD
              </span>
              {extractedInfo.methodFound ? (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Found in POU
                </span>
              ) : (
                <span className="text-[10px] text-amber-400 flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  New Method
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              Runs before doState() on every PLC scan cycle • In {tcPouFileName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Toggle Declaration Top Panel Button */}
          <button
            type="button"
            onClick={() => setShowDeclaration(!showDeclaration)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              showDeclaration
                ? 'bg-slate-800 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Toggle top panel (method declaration and local variables)"
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span className="hidden sm:inline">Top Panel</span>
            <span className="px-1 py-0.2 text-[9px] rounded bg-sky-950 text-sky-300 font-mono border border-sky-800/60">
              {showDeclaration ? `${Math.round(splitRatio * 100)}%` : 'Hidden'}
            </span>
            {showDeclaration ? (
              <ChevronDown className="w-3 h-3 ml-0.5 text-slate-400" />
            ) : (
              <ChevronRight className="w-3 h-3 ml-0.5 text-slate-400" />
            )}
          </button>

          {/* Copy Code */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Copy Structured Text to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          {/* Expand / Minimize */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title={isExpanded ? 'Restore size' : 'Expand full window'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close button if modal or onClose provided */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Status banner */}
      {saveStatus.message && (
        <div
          className={`px-3.5 py-1.5 text-xs flex items-center gap-2 border-b shrink-0 ${
            saveStatus.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800/80 text-rose-300'
          }`}
        >
          {saveStatus.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="font-medium flex-1">{saveStatus.message}</span>
          <button
            type="button"
            onClick={() => setSaveStatus({ type: 'idle' })}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Resizable Panels Container: Top Panel (Declaration) and Bottom Panel (Implementation) */}
      <div
        ref={splitContainerRef}
        id="preprocess-split-panels-container"
        className="flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-950 relative"
      >
        {/* Top Panel: Method Declaration (<Declaration>) */}
        {showDeclaration && (
          <div
            id="preprocess-top-panel"
            style={{ height: `calc(${splitRatio * 100}% - 5px)` }}
            className="flex flex-col min-h-[44px] max-h-[calc(100%-56px)] overflow-hidden bg-slate-950 shrink-0"
          >
            {/* Top Panel Section Header */}
            <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950/90 border-b border-slate-800/80 text-[11px] font-mono shrink-0 select-none">
              <div className="flex items-center gap-2 text-slate-300">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-slate-200">Top Panel: Declaration</span>
                <span className="text-[10px] text-slate-500">&lt;Declaration&gt;</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
                  {declLineCount} {declLineCount === 1 ? 'line' : 'lines'}
                </span>
                <span className="text-[10px] text-sky-400 font-mono font-medium">
                  {Math.round(splitRatio * 100)}%
                </span>
              </div>
            </div>

            {/* Declaration Code Editor Area */}
            <div className="relative flex flex-1 min-h-0 bg-slate-950 font-mono text-xs overflow-hidden">
              {/* Declaration Line Numbers Gutter */}
              <div
                ref={declLineNumbersRef}
                aria-hidden="true"
                className="w-12 py-3 px-1.5 bg-slate-950 border-r border-slate-800/80 text-sky-400/60 text-right select-none overflow-hidden font-mono text-xs leading-[1.625rem] shrink-0"
              >
                {declLines.map((num) => (
                  <div key={num} className="leading-[1.625rem]">
                    {num}
                  </div>
                ))}
              </div>

              {/* Declaration Textarea */}
              <div className="relative flex-1 h-full min-w-0">
                <textarea
                  ref={declTextareaRef}
                  id="preprocess-decl-code-textarea"
                  value={declaration}
                  onChange={(e) => {
                    setDeclaration(e.target.value);
                    setSaveStatus({ type: 'idle' });
                  }}
                  onScroll={handleDeclScroll}
                  onKeyDown={handleDeclKeyDown}
                  placeholder="METHOD preProcess&#10;VAR_INST&#10;&#9;// Local variables here&#10;END_VAR"
                  className="w-full h-full p-3 bg-transparent text-sky-100 placeholder:text-slate-600 font-mono text-xs leading-[1.625rem] focus:outline-none resize-none overflow-auto whitespace-pre tab-4"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        )}

        {/* Panel Splitter (Active when Top Panel is expanded) */}
        {showDeclaration && (
          <div
            id="preprocess-panel-splitter"
            role="separator"
            aria-orientation="horizontal"
            tabIndex={0}
            title="Drag to resize panels • Double-click to reset (20% / 80%)"
            onMouseDown={handleSplitterMouseDown}
            onTouchStart={handleSplitterTouchStart}
            onDoubleClick={() => setSplitRatio(0.2)}
            className={`group relative h-2.5 w-full bg-slate-900 hover:bg-sky-950/80 border-y border-slate-800/90 cursor-row-resize flex items-center justify-center transition-colors shrink-0 select-none z-10 ${
              isDraggingSplitter ? 'bg-sky-900/90 border-sky-500/70' : ''
            }`}
          >
            {/* Visual handle graphic */}
            <div className="flex items-center gap-1.5 text-slate-500 group-hover:text-sky-300 transition-colors">
              <div className="w-8 h-0.5 bg-slate-700 group-hover:bg-sky-400 rounded-full transition-colors" />
              <GripHorizontal className="w-3.5 h-3 text-slate-500 group-hover:text-sky-300" />
              <div className="w-8 h-0.5 bg-slate-700 group-hover:bg-sky-400 rounded-full transition-colors" />
            </div>

            {/* Floating percentage badge during hover or active drag */}
            <div
              className={`absolute right-3 px-1.5 py-0.5 rounded text-[9px] font-mono transition-opacity pointer-events-none ${
                isDraggingSplitter
                  ? 'opacity-100 bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50'
                  : 'opacity-0 group-hover:opacity-100 bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {Math.round(splitRatio * 100)}% / {Math.round((1 - splitRatio) * 100)}%
            </div>
          </div>
        )}

        {/* Bottom Panel: Implementation Structured Text (<ST>) - 100% when Top Panel collapsed, or remaining space when expanded */}
        <div
          id="preprocess-bottom-panel"
          className={`flex flex-col overflow-hidden bg-slate-950 ${
            showDeclaration ? 'flex-1 min-h-[56px]' : 'flex-1 h-full min-h-0'
          }`}
        >
          {/* Bottom Panel Section Header */}
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950/90 border-b border-slate-800/80 text-[11px] font-mono shrink-0 select-none">
            <div className="flex items-center gap-2 text-slate-300">
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-slate-200">Bottom Panel: Implementation</span>
              <span className="text-[10px] text-slate-500">&lt;Implementation&gt;&lt;ST&gt;</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-mono">
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </span>
              <span className="text-[10px] text-emerald-400 font-mono font-medium">
                {showDeclaration ? `${Math.round((1 - splitRatio) * 100)}%` : '100%'}
              </span>
            </div>
          </div>

          {/* Transitions Banner if detected */}
          {currentTransitions.length > 0 && (
            <div className="bg-slate-950/90 px-3.5 py-1.5 flex items-center gap-2 text-[11px] overflow-x-auto shrink-0 border-b border-slate-800/80">
              <span className="text-slate-400 shrink-0 flex items-center gap-1 font-medium">
                <ArrowRight className="w-3 h-3 text-sky-400" />
                Global State Transitions in preProcess:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {currentTransitions.map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => onJumpToState?.(target)}
                    className="px-2 py-0.5 rounded bg-sky-950/90 hover:bg-sky-900 border border-sky-800/80 text-sky-300 font-mono text-[10px] transition-colors flex items-center gap-1"
                    title={`Click to focus ${target} in Diagram Canvas`}
                  >
                    <span>:=</span>
                    <span className="font-semibold">{target}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Implementation ST Editor Body */}
          <div className="relative flex-1 min-h-0 flex overflow-hidden bg-slate-950 font-mono text-xs">
            {/* Line Numbers Gutter */}
            <div
              ref={lineNumbersRef}
              aria-hidden="true"
              className="w-12 py-3 px-1.5 bg-slate-950 border-r border-slate-800/80 text-slate-600 text-right select-none overflow-hidden font-mono text-xs leading-[1.625rem] shrink-0"
            >
              {lines.map((num) => (
                <div key={num} className="leading-[1.625rem]">
                  {num}
                </div>
              ))}
            </div>

            {/* Implementation Textarea */}
            <div className="relative flex-1 h-full min-w-0">
              <textarea
                ref={textareaRef}
                id="preprocess-st-code-textarea"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setSaveStatus({ type: 'idle' });
                }}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                placeholder="// Enter preProcess() Structured Text here...&#10;SUPER^.preProcess();&#10;&#10;IF (bEmergencyHalt) THEN&#10;    machineState := TABLEMANAGER_ERROR;&#10;END_IF"
                className="w-full h-full p-3 bg-transparent text-slate-100 placeholder:text-slate-600 font-mono text-xs leading-[1.625rem] focus:outline-none resize-none overflow-auto whitespace-pre tab-4"
                spellCheck={false}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Transparent drag overlay to capture mouse movement across textareas */}
      {isDraggingSplitter && (
        <div className="fixed inset-0 z-[120] cursor-row-resize select-none" />
      )}

      {/* Editor Footer Actions */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-t border-slate-800 shrink-0 gap-2">
        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes in preProcess()
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              Synchronized with POU
            </span>
          )}
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            (Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Ctrl+S</kbd> to save)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Revert / Reset */}
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-400 transition-colors"
            title="Revert to code from POU file"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Revert</span>
          </button>

          {/* Save Button */}
          <button
            id="save-preprocess-code-btn"
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
              isDirty
                ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/30 ring-1 ring-sky-400/50'
                : 'bg-slate-800 text-slate-400 disabled:opacity-40'
            }`}
            title="Write changes back to .TcPOU and re-render diagrams"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save to POU & Refresh</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
        {editorContent}
      </div>
    );
  }

  return editorContent;
>>>>>>> 6743ef0ad9a3d2bf2f03684fb34e4c0fe64f9323
};
