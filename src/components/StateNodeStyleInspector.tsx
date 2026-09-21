import React, { useState } from 'react';
import {
  Palette,
  X,
  RotateCcw,
  Sparkles,
  ChevronDown,
  Trash2,
  Sliders,
  Eye,
  Check,
  Code2,
  FileCode,
} from 'lucide-react';
import {
  ColorPreset,
  CustomNodeStylesMap,
  NodeDisplayProperties,
  StateNodeInfo,
} from '../types.ts';
import {
  BORDER_WIDTH_OPTIONS,
  CURATED_COLOR_PRESETS,
  QUICK_BG_SWATCHES,
  QUICK_BORDER_SWATCHES,
  QUICK_TEXT_SWATCHES,
} from '../utils/nodeStyles.ts';
import { StateStructuredTextEditor } from './StateStructuredTextEditor.tsx';
import { PreProcessStructuredTextEditor } from './PreProcessStructuredTextEditor.tsx';

export interface StateNodeStyleInspectorProps {
  selectedStateId: string;
  selectedStateLabel?: string;
  availableStates: StateNodeInfo[];
  customStyles: CustomNodeStylesMap;
  onStyleChange: (stateId: string, style: NodeDisplayProperties) => void;
  onResetStateStyle: (stateId: string) => void;
  onClearAllCustomStyles: () => void;
  onSelectState: (stateId: string, label?: string) => void;
  onClose: () => void;
  tcPouContent?: string;
  tcPouFileName?: string;
  onSaveStateCode?: (stateId: string, newCode: string) => { success: boolean; error?: string };
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  initialMode?: 'code' | 'preprocess' | 'style';
}

export const StateNodeStyleInspector: React.FC<StateNodeStyleInspectorProps> = ({
  selectedStateId,
  selectedStateLabel,
  availableStates,
  customStyles,
  onStyleChange,
  onResetStateStyle,
  onClearAllCustomStyles,
  onSelectState,
  onClose,
  tcPouContent,
  tcPouFileName,
  onSaveStateCode,
  onSavePreProcessCode,
  initialMode = 'code',
}) => {
  const [inspectorMode, setInspectorMode] = useState<'code' | 'preprocess' | 'style'>(initialMode);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('custom');
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);

  const currentStyle: NodeDisplayProperties = customStyles[selectedStateId] || {};
  const isCustomized = Boolean(
    currentStyle.fill || currentStyle.color || currentStyle.stroke || currentStyle.strokeWidth
  );

  const customizedCount = Object.values(customStyles).filter(
    (s) => s.fill || s.color || s.stroke || s.strokeWidth
  ).length;

  const handleUpdate = (updates: Partial<NodeDisplayProperties>) => {
    const nextStyle: NodeDisplayProperties = {
      ...currentStyle,
      ...updates,
    };
    // If all are cleared, remove
    if (!nextStyle.fill && !nextStyle.color && !nextStyle.stroke && !nextStyle.strokeWidth) {
      onResetStateStyle(selectedStateId);
    } else {
      onStyleChange(selectedStateId, nextStyle);
    }
  };

  const handleApplyPreset = (preset: ColorPreset) => {
    onStyleChange(selectedStateId, {
      fill: preset.fill,
      color: preset.color,
      stroke: preset.stroke,
      strokeWidth: preset.strokeWidth,
    });
  };

  const currentFill = currentStyle.fill || '#1e293b';
  const currentColor = currentStyle.color || '#f8fafc';
  const currentStroke = currentStyle.stroke || '#475569';
  const currentStrokeWidth = currentStyle.strokeWidth || '2px';

  return (
    <div
      id="state-style-inspector"
      style={{
        width:
          inspectorMode === 'code' || inspectorMode === 'preprocess'
            ? isExpanded
              ? '780px'
              : '560px'
            : '340px',
        height:
          inspectorMode === 'code' || inspectorMode === 'preprocess'
            ? isExpanded
              ? 'calc(100vh - 24px)'
              : '700px'
            : undefined,
      }}
      className="absolute top-3 right-3 z-30 max-w-[calc(100%-24px)] max-h-[calc(100vh-24px)] bg-slate-900/95 border border-slate-700/90 rounded-xl shadow-2xl backdrop-blur-md text-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`p-1 rounded-md ${
              inspectorMode === 'code'
                ? 'bg-sky-500/20 text-sky-400'
                : inspectorMode === 'preprocess'
                ? 'bg-indigo-500/20 text-indigo-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {inspectorMode === 'code' ? (
              <Code2 className="w-4 h-4" />
            ) : inspectorMode === 'preprocess' ? (
              <FileCode className="w-4 h-4" />
            ) : (
              <Palette className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-white truncate">
              {inspectorMode === 'code'
                ? 'State Structured Text Editor'
                : inspectorMode === 'preprocess'
                ? 'preProcess() Method Editor'
                : 'State Node Appearance'}
            </h3>
            <p className="text-[10px] text-slate-400 truncate">
              {inspectorMode === 'preprocess'
                ? 'preProcess() Structured Text in .TcPOU'
                : selectedStateLabel || selectedStateId}
            </p>
          </div>
        </div>

        <button
          id="close-inspector-btn"
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close Inspector (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 gap-1">
        <button
          type="button"
          id="inspector-mode-code-tab"
          onClick={() => setInspectorMode('code')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
            inspectorMode === 'code'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="View and edit doState() code for this state branch"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>doState()</span>
        </button>

        <button
          type="button"
          id="inspector-mode-preprocess-tab"
          onClick={() => setInspectorMode('preprocess')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
            inspectorMode === 'preprocess'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="View and edit preProcess() Structured Text method in .TcPOU"
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>preProcess()</span>
        </button>

        <button
          type="button"
          id="inspector-mode-style-tab"
          onClick={() => setInspectorMode('style')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
            inspectorMode === 'style'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Customize fill, border, and text appearance"
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Style</span>
          {isCustomized && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block ml-0.5" />
          )}
        </button>
      </div>

      {/* State Switcher & Customization Status (Hidden when viewing preProcess) */}
      {inspectorMode !== 'preprocess' && (
        <div className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between gap-2 text-xs">
          {/* Dropdown to pick different state */}
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              id="state-selector-dropdown-btn"
              onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
              className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 transition-all"
              title="Switch state node"
            >
              <span className="truncate">{selectedStateId}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {isStateDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-slate-950 border border-slate-700 rounded-lg shadow-xl py-1 z-40 text-xs font-mono">
                {availableStates.map((s) => {
                  const hasStyle = Boolean(customStyles[s.id]);
                  const isSelected = s.id === selectedStateId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onSelectState(s.id, s.label);
                        setIsStateDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-slate-800 transition-colors ${
                        isSelected ? 'bg-sky-950/60 text-sky-400 font-medium' : 'text-slate-300'
                      }`}
                    >
                      <span className="truncate">{s.id}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasStyle && (
                          <span
                            className="w-2 h-2 rounded-full bg-emerald-400 inline-block"
                            title="Customized style"
                          />
                        )}
                        {isSelected && <Check className="w-3 h-3 text-sky-400" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status Badge */}
          {isCustomized ? (
            <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 text-[10px] font-medium shrink-0">
              Custom Style
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] shrink-0">
              Default Theme
            </span>
          )}
        </div>
      )}

      {/* Main Content: ST Code Editor OR preProcess Editor OR Appearance Customizer */}
      {inspectorMode === 'code' ? (
        <StateStructuredTextEditor
          selectedStateId={selectedStateId}
          selectedStateLabel={selectedStateLabel}
          tcPouContent={tcPouContent}
          tcPouFileName={tcPouFileName}
          onSaveStateCode={onSaveStateCode}
          isExpanded={isExpanded}
          onToggleExpand={() => setIsExpanded((prev) => !prev)}
        />
      ) : inspectorMode === 'preprocess' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <PreProcessStructuredTextEditor
            tcPouContent={tcPouContent}
            tcPouFileName={tcPouFileName}
            onSavePreProcessCode={onSavePreProcessCode}
            onJumpToState={(target) => onSelectState(target)}
            isModal={false}
          />
        </div>
      ) : (
        <>

      {/* Live Preview Box */}
      <div className="px-3.5 py-2.5 bg-slate-950/50 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3 text-sky-400" /> Live Preview
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {currentStyle.fill ? currentStyle.fill : 'Default fill'}
          </span>
        </div>
        <div className="flex items-center justify-center p-3 rounded-lg bg-slate-900/60 border border-slate-800/80 min-h-[64px]">
          <div
            id="state-node-live-preview"
            style={{
              backgroundColor: currentFill,
              color: currentColor,
              borderColor: currentStroke,
              borderWidth: currentStrokeWidth,
              borderStyle: 'solid',
            }}
            className="px-4 py-2 rounded-md font-sans text-xs font-medium shadow-md transition-all text-center max-w-full truncate"
          >
            {selectedStateLabel || selectedStateId}
          </div>
        </div>
      </div>

      {/* View Tabs: Custom Colors vs Presets */}
      <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('custom')}
          className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'custom'
              ? 'border-sky-500 text-sky-400 bg-slate-900/70'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Colors</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('presets')}
          className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'presets'
              ? 'border-sky-500 text-sky-400 bg-slate-900/70'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Quick Presets</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-3.5 space-y-3.5 max-h-[360px] overflow-y-auto custom-scrollbar text-xs">
        {activeTab === 'custom' ? (
          <div className="space-y-3">
            {/* 1. Background Color (fill) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-200">
                  Background Color (Fill)
                </label>
                <span className="text-[10px] font-mono text-slate-400">
                  {currentStyle.fill || 'default'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  id="node-fill-color-picker"
                  type="color"
                  value={currentStyle.fill || '#1e293b'}
                  onChange={(e) => handleUpdate({ fill: e.target.value })}
                  className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                  title="Choose exact fill color"
                />
                <input
                  id="node-fill-hex-input"
                  type="text"
                  value={currentStyle.fill || ''}
                  placeholder="#1e293b"
                  onChange={(e) => handleUpdate({ fill: e.target.value })}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
                {currentStyle.fill && (
                  <button
                    type="button"
                    onClick={() => handleUpdate({ fill: undefined })}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                    title="Clear background override"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Quick Swatches */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_BG_SWATCHES.map((sw) => (
                  <button
                    key={sw.label}
                    type="button"
                    onClick={() => handleUpdate({ fill: sw.value || undefined })}
                    className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
                      currentStyle.fill === sw.value
                        ? 'ring-2 ring-sky-400 scale-105 border-white'
                        : 'border-slate-700'
                    }`}
                    style={{
                      backgroundColor: sw.value || '#334155',
                    }}
                    title={sw.label}
                  />
                ))}
              </div>
            </div>

            {/* 2. Foreground / Text Color (color) */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-200">
                  Text Color (Foreground)
                </label>
                <span className="text-[10px] font-mono text-slate-400">
                  {currentStyle.color || 'default'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  id="node-text-color-picker"
                  type="color"
                  value={currentStyle.color || '#ffffff'}
                  onChange={(e) => handleUpdate({ color: e.target.value })}
                  className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                  title="Choose exact text color"
                />
                <input
                  id="node-text-hex-input"
                  type="text"
                  value={currentStyle.color || ''}
                  placeholder="#ffffff"
                  onChange={(e) => handleUpdate({ color: e.target.value })}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
                {currentStyle.color && (
                  <button
                    type="button"
                    onClick={() => handleUpdate({ color: undefined })}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                    title="Clear text color override"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Quick Text Swatches */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TEXT_SWATCHES.map((sw) => (
                  <button
                    key={sw.label}
                    type="button"
                    onClick={() => handleUpdate({ color: sw.value || undefined })}
                    className={`w-5 h-5 rounded border transition-transform hover:scale-110 flex items-center justify-center text-[10px] font-bold ${
                      currentStyle.color === sw.value
                        ? 'ring-2 ring-sky-400 scale-105 border-white'
                        : 'border-slate-700'
                    }`}
                    style={{
                      backgroundColor: sw.value || '#475569',
                      color: sw.value === '#ffffff' || sw.value === '#fde047' ? '#0f172a' : '#ffffff',
                    }}
                    title={sw.label}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Border Color & Width (stroke & stroke-width) */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-200">
                  Border (Stroke & Width)
                </label>
                <span className="text-[10px] font-mono text-slate-400">
                  {currentStyle.stroke || 'default'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  id="node-stroke-color-picker"
                  type="color"
                  value={currentStyle.stroke || '#475569'}
                  onChange={(e) => handleUpdate({ stroke: e.target.value })}
                  className="w-7 h-7 rounded border border-slate-700 bg-slate-950 cursor-pointer p-0.5 shrink-0"
                  title="Choose exact border color"
                />
                <input
                  id="node-stroke-hex-input"
                  type="text"
                  value={currentStyle.stroke || ''}
                  placeholder="#475569"
                  onChange={(e) => handleUpdate({ stroke: e.target.value })}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
                {/* Border width segmented selector */}
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-[10px]">
                  {BORDER_WIDTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleUpdate({ strokeWidth: opt.value })}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        currentStyle.strokeWidth === opt.value
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Border Swatches */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_BORDER_SWATCHES.map((sw) => (
                  <button
                    key={sw.label}
                    type="button"
                    onClick={() => handleUpdate({ stroke: sw.value || undefined })}
                    className={`w-5 h-5 rounded border-2 transition-transform hover:scale-110 ${
                      currentStyle.stroke === sw.value
                        ? 'ring-2 ring-sky-400 scale-105 border-white'
                        : 'border-slate-700'
                    }`}
                    style={{
                      borderColor: sw.value || '#64748b',
                      backgroundColor: '#090d16',
                    }}
                    title={sw.label}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Presets Tab */
          <div className="space-y-2">
            <p className="text-[11px] text-slate-400 mb-1">
              Click a preset to apply coordinated background, text, and border styling:
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {CURATED_COLOR_PRESETS.map((preset) => {
                const isActive =
                  currentStyle.fill === preset.fill &&
                  currentStyle.color === preset.color &&
                  currentStyle.stroke === preset.stroke;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                      isActive
                        ? 'border-sky-400 bg-sky-950/40 ring-1 ring-sky-400'
                        : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] shrink-0 border"
                        style={{
                          backgroundColor: preset.fill,
                          color: preset.color,
                          borderColor: preset.stroke,
                          borderWidth: preset.strokeWidth,
                        }}
                      >
                        S
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-white">{preset.name}</div>
                        <div className="text-[10px] text-slate-400">{preset.description}</div>
                      </div>
                    </div>
                    {isActive && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="px-3.5 py-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
        <button
          id="reset-state-style-btn"
          type="button"
          onClick={() => onResetStateStyle(selectedStateId)}
          disabled={!isCustomized}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-400 disabled:opacity-40 disabled:hover:text-slate-400 transition-colors"
          title="Reset this state to default theme"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset State</span>
        </button>

        <div className="flex items-center gap-2">
          {customizedCount > 1 && (
            <button
              id="clear-all-state-styles-btn"
              type="button"
              onClick={onClearAllCustomStyles}
              className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
              title="Clear all customized states"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset All ({customizedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow transition-colors"
          >
            Done
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
