import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Download,
  Copy,
  ExternalLink,
  Check,
  RotateCcw,
  Sparkles,
  GitFork,
  Settings2,
  FileCode2,
  CheckCircle2,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
} from 'lucide-react';
import { generateStatechart, PriorityFormat } from './generator.ts';
import { MermaidViewer, LayoutEngine, FlowchartCurve, MermaidTheme } from './components/MermaidViewer.tsx';
import { MermaidMarkdownViewer } from './components/MermaidMarkdownViewer.tsx';
import { FileDropzone } from './components/FileDropzone.tsx';
import { SAMPLES, SampleItem } from './samples/samplesData.ts';
import { getMermaidLiveUrl } from './utils/mermaidLive.ts';
import { CustomNodeStylesMap, NodeDisplayProperties, DiagramNotes, ContextMenuTarget, NotePosition } from './types.ts';
import { applyCustomStylesToMermaid } from './utils/nodeStyles.ts';
import { applyNotesToMermaid } from './utils/diagramNotes.ts';
import { NodeOffsetsMap } from './utils/nodeDragger.ts';
import {
  CanvasNodePositionsMap,
  extractCanvasNodePositions,
  appendCanvasPositionsToMermaid,
} from './utils/canvasPositions.ts';
import { copyTextToClipboard } from './utils/diagramExport.ts';

export const App: React.FC = () => {
  // Active sample or custom state
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLES[0].id);

  // Input states
  const [dutFileName, setDutFileName] = useState<string>(SAMPLES[0].dutName);
  const [dutContent, setDutContent] = useState<string>(SAMPLES[0].dutContent);
  const [pouFileName, setPouFileName] = useState<string>(SAMPLES[0].pouName);
  const [pouContent, setPouContent] = useState<string>(SAMPLES[0].pouContent);

  // Configuration options matching C# LauncherForm
  const [flowchartOutput, setFlowchartOutput] = useState<boolean>(SAMPLES[0].defaultFlowchart);
  const [collapseErrorSinkEdges, setCollapseErrorSinkEdges] = useState<boolean>(true);
  const [includeStateDescriptions, setIncludeStateDescriptions] = useState<boolean>(
    SAMPLES[0].defaultIncludeDescriptions
  );
  const [showTransitionPriorities, setShowTransitionPriorities] = useState<boolean>(true);
  const [priorityFormat, setPriorityFormat] = useState<PriorityFormat>('circled');
  const [layoutEngine, setLayoutEngine] = useState<LayoutEngine>('elk');
  const [flowchartCurve, setFlowchartCurve] = useState<FlowchartCurve>('basis');
  const [mermaidTheme, setMermaidTheme] = useState<MermaidTheme>('dark');
  const [liveUpdate, setLiveUpdate] = useState<boolean>(true);

  // UI tabs & states
  const [activeTab, setActiveTab] = useState<'diagram' | 'markdown'>('diagram');
  const [diagramSearchQuery, setDiagramSearchQuery] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);

  // Node display customizations
  const [customNodeStyles, setCustomNodeStyles] = useState<CustomNodeStylesMap>({});
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedStateLabel, setSelectedStateLabel] = useState<string>('');

  // Diagram notes state
  const [diagramNotes, setDiagramNotes] = useState<DiagramNotes>({
    nodes: {},
    edges: {},
  });

  // Node drag offsets and canvas extracted positions
  const [nodeOffsets, setNodeOffsets] = useState<NodeOffsetsMap>({});
  const [canvasPositions, setCanvasPositions] = useState<CanvasNodePositionsMap>({});

  // Raw generated Mermaid Markdown
  const [rawMarkdown, setRawMarkdown] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStats, setGenerationStats] = useState<{
    statesCount: number;
    linesCount: number;
    timeMs: number;
  } | null>(null);

  // Core generation logic
  const handleGenerate = useCallback(() => {
    if (!dutContent.trim() && !pouContent.trim()) {
      setRawMarkdown('');
      setGenerationError('Please provide both .TcDUT and .TcPOU content.');
      setGenerationStats(null);
      return;
    }

    try {
      const startTime = performance.now();
      setGenerationError(null);
      const result = generateStatechart(dutContent, pouContent, {
        flowchartOutput,
        collapseErrorSinkEdges,
        includeStateDescriptions,
        showTransitionPriorities,
        priorityFormat,
      });

      const elapsed = Math.round(performance.now() - startTime);
      setRawMarkdown(result);

      // Simple stats extraction
      const lines = result.split('\n');
      const stateMatches = result.match(/-->/g) || [];
      setGenerationStats({
        statesCount: stateMatches.length,
        linesCount: lines.length,
        timeMs: elapsed,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerationError(msg);
      setRawMarkdown('');
      setGenerationStats(null);
    }
  }, [
    dutContent,
    pouContent,
    flowchartOutput,
    collapseErrorSinkEdges,
    includeStateDescriptions,
    showTransitionPriorities,
    priorityFormat,
  ]);

  // Apply custom node styles for live diagram canvas display
  const styledMarkdown = useMemo(() => {
    return applyCustomStylesToMermaid(rawMarkdown, customNodeStyles);
  }, [rawMarkdown, customNodeStyles]);

  // Apply diagram notes and canvas positions metadata to Mermaid markdown
  const outputMarkdown = useMemo(() => {
    const withNotes = applyNotesToMermaid(styledMarkdown, diagramNotes);
    return appendCanvasPositionsToMermaid(withNotes, canvasPositions, {
      layoutEngine,
      flowchartCurve,
      theme: mermaidTheme,
    });
  }, [styledMarkdown, diagramNotes, canvasPositions, layoutEngine, flowchartCurve, mermaidTheme]);

  const handleStyleChange = useCallback((stateId: string, style: NodeDisplayProperties) => {
    setCustomNodeStyles((prev) => ({
      ...prev,
      [stateId]: style,
    }));
  }, []);

  const handleResetStateStyle = useCallback((stateId: string) => {
    setCustomNodeStyles((prev) => {
      const next = { ...prev };
      delete next[stateId];
      return next;
    });
  }, []);

  const handleClearAllCustomStyles = useCallback(() => {
    setCustomNodeStyles({});
  }, []);

  const handleSaveNote = useCallback((target: ContextMenuTarget, text: string) => {
    setDiagramNotes((prev) => {
      const trimmed = text.trim();
      if (target.type === 'node') {
        const nextNodes = { ...prev.nodes };
        if (trimmed) {
          nextNodes[target.id] = trimmed;
        } else {
          delete nextNodes[target.id];
        }
        return { ...prev, nodes: nextNodes };
      } else if (target.type === 'edge') {
        const canonicalKey =
          target.from && target.to
            ? target.id.includes('#')
              ? target.id
              : `${target.from}->${target.to}`
            : target.id;
        const nextEdges = { ...prev.edges };
        if (trimmed) {
          nextEdges[canonicalKey] = trimmed;
          if (target.id !== canonicalKey) {
            delete nextEdges[target.id];
          }
          if (target.pathId && target.pathId !== canonicalKey) {
            delete nextEdges[target.pathId];
          }
        } else {
          delete nextEdges[canonicalKey];
          delete nextEdges[target.id];
          if (target.pathId) delete nextEdges[target.pathId];
        }
        return { ...prev, edges: nextEdges };
      }
      return prev;
    });
  }, []);

  const handleDeleteNote = useCallback((target: ContextMenuTarget) => {
    if (target.type === 'canvas') return;
    setDiagramNotes((prev) => {
      const nextPositions = { ...(prev.positions || {}) };
      delete nextPositions[target.id];
      if (target.type === 'edge' && target.pathId) {
        delete nextPositions[target.pathId];
      }

      const nextStyles = { ...(prev.styles || {}) };
      delete nextStyles[target.id];
      if (target.type === 'edge' && target.pathId) {
        delete nextStyles[target.pathId];
      }

      if (target.type === 'node') {
        const nextNodes = { ...prev.nodes };
        delete nextNodes[target.id];
        return { ...prev, nodes: nextNodes, positions: nextPositions, styles: nextStyles };
      } else if (target.type === 'edge') {
        const canonicalKey =
          target.from && target.to
            ? target.id.includes('#')
              ? target.id
              : `${target.from}->${target.to}`
            : target.id;
        delete nextPositions[canonicalKey];
        delete nextStyles[canonicalKey];
        const nextEdges = { ...prev.edges };
        delete nextEdges[canonicalKey];
        delete nextEdges[target.id];
        if (target.pathId) delete nextEdges[target.pathId];
        return { ...prev, edges: nextEdges, positions: nextPositions, styles: nextStyles };
      }
      return prev;
    });
  }, []);

  const handleUpdateNotePosition = useCallback((targetId: string, pos: NotePosition) => {
    setDiagramNotes((prev) => ({
      ...prev,
      positions: {
        ...(prev.positions || {}),
        [targetId]: pos,
      },
    }));
  }, []);

  const handleUpdateNoteStyle = useCallback((targetId: string, style: NodeDisplayProperties | null) => {
    setDiagramNotes((prev) => {
      const nextStyles = { ...(prev.styles || {}) };
      if (style === null) {
        delete nextStyles[targetId];
      } else {
        nextStyles[targetId] = style;
      }
      return {
        ...prev,
        styles: nextStyles,
      };
    });
  }, []);

  const handleClearAllNotes = useCallback(() => {
    setDiagramNotes({ nodes: {}, edges: {}, positions: {}, styles: {} });
  }, []);

  const customizedStatesCount = useMemo(() => {
    return Object.values(customNodeStyles).filter(
      (s) => s.fill || s.color || s.stroke || s.strokeWidth
    ).length;
  }, [customNodeStyles]);

  // Initial & reactive generation
  useEffect(() => {
    if (liveUpdate) {
      handleGenerate();
    }
  }, [handleGenerate, liveUpdate]);

  // Handle sample selection
  const handleSelectSample = (sample: SampleItem) => {
    setSelectedSampleId(sample.id);
    setDutFileName(sample.dutName);
    setDutContent(sample.dutContent);
    setPouFileName(sample.pouName);
    setPouContent(sample.pouContent);
    setFlowchartOutput(sample.defaultFlowchart);
    setIncludeStateDescriptions(sample.defaultIncludeDescriptions);
    setCustomNodeStyles({});
    setDiagramNotes({ nodes: {}, edges: {} });
    setNodeOffsets({});
    setCanvasPositions({});
    setSelectedStateId(null);
    setSelectedStateLabel('');
  };

  // Helper to extract the most up-to-date canvas positions and generate the full exported markdown
  const getLatestFullMarkdown = useCallback(() => {
    const livePositions = extractCanvasNodePositions(
      document.getElementById('mermaid-canvas-area')?.querySelector('svg'),
      nodeOffsets
    );
    const effectivePositions = Object.keys(livePositions).length > 0 ? livePositions : canvasPositions;
    const withNotes = applyNotesToMermaid(styledMarkdown, diagramNotes);
    return appendCanvasPositionsToMermaid(withNotes, effectivePositions, {
      layoutEngine,
      flowchartCurve,
      theme: mermaidTheme,
    });
  }, [nodeOffsets, canvasPositions, styledMarkdown, diagramNotes, layoutEngine, flowchartCurve, mermaidTheme]);

  // Actions
  const handleCopyMarkdown = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    copyTextToClipboard(md).then((ok) => {
      if (ok) {
        setCopiedMarkdown(true);
        setTimeout(() => setCopiedMarkdown(false), 2000);
      }
    });
  };

  const handleDownload = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = pouFileName.replace(/\.TcPOU$/i, '') || 'statechart';
    link.href = url;
    link.download = `${baseName}.statechart.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleOpenMermaidLive = () => {
    const md = getLatestFullMarkdown() || outputMarkdown;
    if (!md) return;
    const liveUrl = getMermaidLiveUrl(md, {
      layout: layoutEngine,
      curve: flowchartCurve,
      theme: mermaidTheme,
    });
    window.open(liveUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Application Bar */}
      <header
        id="app-header"
        className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 backdrop-blur shrink-0"
      >
        <div className="flex items-center gap-3">
          <button
            id="toggle-sidebar-btn"
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title={isSidebarOpen ? 'Collapse inputs' : 'Expand inputs'}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold">
              <GitFork className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                TcPouStatechartGenerator
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800/60 font-mono">
                  Web Edition
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                TwinCAT PLC Statechart & Flowchart Diagram Generator
              </p>
            </div>
          </div>
        </div>

        {/* Header Action Bar */}
        <div className="flex items-center gap-2">
          {/* Sample Selector */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg px-2 py-1 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 text-[11px] font-medium hidden sm:inline">Sample:</span>
            <select
              id="sample-selector"
              value={selectedSampleId}
              onChange={(e) => {
                const sample = SAMPLES.find((s) => s.id === e.target.value);
                if (sample) handleSelectSample(sample);
              }}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-1"
            >
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900 text-slate-200">
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 mx-1 hidden sm:block"></div>

          {/* Re-generate button if live update is off */}
          {!liveUpdate && (
            <button
              id="generate-button"
              type="button"
              onClick={handleGenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Generate</span>
            </button>
          )}

          {/* Copy Markdown */}
          <button
            id="copy-markdown-btn"
            type="button"
            onClick={handleCopyMarkdown}
            disabled={!outputMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-40"
            title="Copy Mermaid Markdown"
          >
            {copiedMarkdown ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{copiedMarkdown ? 'Copied' : 'Copy Markdown'}</span>
          </button>

          {/* Download File */}
          <button
            id="download-file-btn"
            type="button"
            onClick={handleDownload}
            disabled={!outputMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-40"
            title="Download .statechart.md"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Download</span>
          </button>

          {/* Open in Mermaid Live */}
          <button
            id="open-mermaid-live-btn"
            type="button"
            onClick={handleOpenMermaidLive}
            disabled={!outputMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-40"
            title="Open in mermaid.live"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Mermaid Live</span>
          </button>
        </div>
      </header>

      {/* Options Control Ribbon */}
      <div
        id="options-ribbon"
        className="flex flex-wrap items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800/80 text-xs text-slate-300 gap-3 shrink-0"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-slate-400 font-medium">
            <Settings2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Options:</span>
          </div>

          {/* Format Toggle */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              id="format-flowchart-btn"
              type="button"
              onClick={() => setFlowchartOutput(true)}
              title="Flowchart format (TD): Direct transition arrows with subgraph hierarchy"
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                flowchartOutput ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              flowchart TD
            </button>
            <button
              id="format-statediagram-btn"
              type="button"
              onClick={() => setFlowchartOutput(false)}
              title="State diagram format (v2): Standard UML statechart notation"
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                !flowchartOutput ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              stateDiagram-v2
            </button>
          </div>

          {/* Collapse error sink edges */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              id="collapse-errors-checkbox"
              type="checkbox"
              checked={collapseErrorSinkEdges}
              onChange={(e) => setCollapseErrorSinkEdges(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
            />
            <span className="text-slate-300">Collapse error-sink edges</span>
          </label>

          {/* Include state description */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              id="include-descriptions-checkbox"
              type="checkbox"
              checked={includeStateDescriptions}
              onChange={(e) => setIncludeStateDescriptions(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
            />
            <span className="text-slate-300">Include state descriptions</span>
          </label>

          {/* Show transition priorities & format */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                id="show-priorities-checkbox"
                type="checkbox"
                checked={showTransitionPriorities}
                onChange={(e) => setShowTransitionPriorities(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900"
              />
              <span className="text-slate-300">Priorities</span>
            </label>

            {showTransitionPriorities && (
              <div
                id="priority-format-toggle"
                className="flex items-center bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[11px]"
              >
                <button
                  id="prio-format-paren"
                  type="button"
                  onClick={() => setPriorityFormat('paren')}
                  title="Parentheses format: (1) - clean, standard text, universal font support in mermaid.live"
                  className={`px-2 py-0.5 rounded font-mono transition-colors ${
                    priorityFormat === 'paren'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  (1)
                </button>
                <button
                  id="prio-format-bracket"
                  type="button"
                  onClick={() => setPriorityFormat('bracket')}
                  title="Bracket format: [1] - standard UML index notation"
                  className={`px-2 py-0.5 rounded font-mono transition-colors ${
                    priorityFormat === 'bracket'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  [1]
                </button>
                <button
                  id="prio-format-circled"
                  type="button"
                  onClick={() => setPriorityFormat('circled')}
                  title="Circled Unicode format: ① - TwinCAT visual circled style"
                  className={`px-2 py-0.5 rounded font-mono transition-colors ${
                    priorityFormat === 'circled'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ①
                </button>
              </div>
            )}
          </div>
          {/* Layout Engine: Dagre vs ELK */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-[11px] font-medium">Engine:</span>
            <div
              id="layout-engine-toggle"
              className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]"
            >
              <button
                id="layout-engine-dagre"
                type="button"
                onClick={() => setLayoutEngine('dagre')}
                title="Dagre layout engine: classic Mermaid hierarchical DAG layout"
                className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
                  layoutEngine === 'dagre'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dagre
              </button>
              <button
                id="layout-engine-elk"
                type="button"
                onClick={() => setLayoutEngine('elk')}
                title="ELK (Eclipse Layout Kernel) engine: advanced layered routing matching mermaid.live ELK option"
                className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
                  layoutEngine === 'elk'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ELK
              </button>
            </div>
          </div>

          {/* Flowchart Curve Interpolation */}
          {flowchartOutput && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px] font-medium">Curve:</span>
              <select
                id="flowchart-curve-select"
                value={flowchartCurve}
                onChange={(e) => setFlowchartCurve(e.target.value as FlowchartCurve)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                title="Flowchart link curve interpolation (basis, linear, cardinal, stepAfter, etc.)"
              >
                <option value="basis">basis (Smooth Spline)</option>
                <option value="linear">linear (Straight Lines)</option>
                <option value="cardinal">cardinal (Pass-through)</option>
                <option value="stepAfter">stepAfter (Stepped Orthogonal)</option>
                <option value="monotoneX">monotoneX (Monotone Smooth)</option>
                <option value="natural">natural (Natural Spline)</option>
              </select>
            </div>
          )}

          {/* Theme Preset Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-[11px] font-medium">Theme:</span>
            <select
              id="mermaid-theme-select"
              value={mermaidTheme}
              onChange={(e) => setMermaidTheme(e.target.value as MermaidTheme)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
              title="Mermaid theme preset (dark, base, forest, neutral, default)"
            >
              <option value="dark">dark</option>
              <option value="base">base</option>
              <option value="forest">forest</option>
              <option value="neutral">neutral</option>
              <option value="default">default</option>
            </select>
          </div>

          {/* Custom Node Styles Count Badge */}
          {customizedStatesCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-sky-950/60 border border-sky-800/60 text-sky-400 text-[11px]">
              <Palette className="w-3 h-3" />
              <span>
                {customizedStatesCount} custom state{customizedStatesCount > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={handleClearAllCustomStyles}
                className="ml-1 p-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                title="Reset all custom state node styles"
              >
                <RotateCcw className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>

        {/* Stats & Live update toggle */}
        <div className="flex items-center gap-3">
          {generationStats && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Valid
              </span>
              <span>•</span>
              <span>{generationStats.linesCount} lines</span>
              <span>•</span>
              <span>{generationStats.timeMs}ms</span>
            </div>
          )}

          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 select-none">
            <input
              id="live-update-checkbox"
              type="checkbox"
              checked={liveUpdate}
              onChange={(e) => setLiveUpdate(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500"
            />
            <span>Auto-refresh</span>
          </label>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: File Inputs Drawer */}
        {isSidebarOpen && (
          <aside
            id="source-files-sidebar"
            className="w-full sm:w-80 md:w-96 lg:w-[420px] bg-slate-950/90 border-r border-slate-800/80 flex flex-col shrink-0 overflow-y-auto p-4 gap-4"
          >
            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-sky-400" />
                <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  TwinCAT Source Files
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  const sample = SAMPLES.find((s) => s.id === selectedSampleId) || SAMPLES[0];
                  handleSelectSample(sample);
                }}
                className="text-[11px] text-slate-400 hover:text-sky-400 flex items-center gap-1 transition-colors"
                title="Reset to selected sample defaults"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>

            {/* TcDUT File Dropzone */}
            <FileDropzone
              label="Enum Declaration File"
              fileExtension=".TcDUT"
              fileName={dutFileName}
              content={dutContent}
              onFileLoaded={(name, text) => {
                setDutFileName(name);
                setDutContent(text);
                setSelectedSampleId('');
              }}
              onContentChanged={(text) => {
                setDutContent(text);
              }}
              idPrefix="tcdut"
            />

            {/* TcPOU File Dropzone */}
            <FileDropzone
              label="Function Block POU File"
              fileExtension=".TcPOU"
              fileName={pouFileName}
              content={pouContent}
              onFileLoaded={(name, text) => {
                setPouFileName(name);
                setPouContent(text);
                setSelectedSampleId('');
              }}
              onContentChanged={(text) => {
                setPouContent(text);
              }}
              idPrefix="tcpou"
            />

            {/* Guidance Info Card */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-[11px] text-slate-400 leading-relaxed">
              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                How It Works
              </div>
              <p>
                Parses <code className="text-sky-300">doState()</code> and <code className="text-sky-300">preProcess()</code> from the POU, matches enum sequences from the DUT or embedded UML composites, and emits clean Mermaid diagram markdown.
              </p>
            </div>
          </aside>
        )}

        {/* Right Side: Output Viewer */}
        <main id="output-workspace" className="flex-1 flex flex-col min-w-0 bg-slate-950 p-3 overflow-hidden">
          {/* Output View Tabs */}
          <div className="flex items-center justify-between pb-2 shrink-0">
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button
                id="tab-diagram-btn"
                type="button"
                onClick={() => setActiveTab('diagram')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'diagram'
                    ? 'bg-slate-800 text-sky-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Diagram Canvas
              </button>
              <button
                id="tab-markdown-btn"
                type="button"
                onClick={() => setActiveTab('markdown')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'markdown'
                    ? 'bg-slate-800 text-sky-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Mermaid Markdown
              </button>
            </div>

            {generationError && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/50 border border-rose-900/50 px-2.5 py-1 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="font-medium truncate max-w-sm">{generationError}</span>
              </div>
            )}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 relative">
            {activeTab === 'diagram' ? (
              <MermaidViewer
                code={styledMarkdown}
                layoutEngine={layoutEngine}
                flowchartCurve={flowchartCurve}
                mermaidTheme={mermaidTheme}
                searchQuery={diagramSearchQuery}
                onSearchQueryChange={setDiagramSearchQuery}
                selectedStateId={selectedStateId}
                selectedStateLabel={selectedStateLabel}
                onSelectState={(id, label) => {
                  setSelectedStateId(id);
                  if (label) setSelectedStateLabel(label);
                }}
                customStyles={customNodeStyles}
                onStyleChange={handleStyleChange}
                onResetStateStyle={handleResetStateStyle}
                onClearAllCustomStyles={handleClearAllCustomStyles}
                nodeOffsets={nodeOffsets}
                onNodeOffsetsChange={setNodeOffsets}
                onCanvasPositionsChange={setCanvasPositions}
                notes={diagramNotes}
                onSaveNote={handleSaveNote}
                onDeleteNote={handleDeleteNote}
                onClearAllNotes={handleClearAllNotes}
                onUpdateNotePosition={handleUpdateNotePosition}
                onUpdateNoteStyle={handleUpdateNoteStyle}
                onOpenMermaidLive={handleOpenMermaidLive}
                fileName={pouFileName.replace(/\.TcPOU$/i, '') || 'statechart'}
              />
            ) : (
              <MermaidMarkdownViewer
                code={outputMarkdown}
                fileName={`${pouFileName.replace(/\.TcPOU$/i, '') || 'statechart'}.statechart.md`}
                searchQuery={diagramSearchQuery}
                onSearchQueryChange={setDiagramSearchQuery}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
