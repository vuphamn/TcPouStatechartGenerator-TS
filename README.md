# TcPouStatechartGenerator (Web Edition)

Generates [Mermaid](https://mermaid.js.org/) `flowchart TD` and `stateDiagram-v2` diagrams (and `.statechart.md` files) from Beckhoff TwinCAT PLC state machines.

The tool parses the `doState()` and `preProcess()` methods of a `SM_*.TcPOU`
file together with the enum declared in the matching `E_*_States.TcDUT` file. If
the POU contains a `doState_UmlSC()` method, its UML data is used to derive the
composite (nested) state grouping; otherwise grouping is inferred from the enum
declaration order and naming conventions (states after `*_ENABLING` are placed
inside the `*Enabled` composite).

## Features

- **Interactive In-Browser Diagram Viewer**: Pan, zoom, and fullscreen inspection of generated Mermaid diagrams.
- **Dual Output Formats**: Switch seamlessly between `flowchart TD` (with subgraphs) and `stateDiagram-v2`.
- **Pre-loaded Samples**: 5 production TwinCAT state machine samples (Door Dasher with nested UML composites, Table Manager, K-Analog Measure, Feed Manager, and K-Motor VFD) ready to inspect with 1 click.
- **Drag & Drop Upload**: Drop `.TcDUT` and `.TcPOU` files directly into the browser or edit Structured Text inline.
- **Export & Live Integration**: Copy Markdown, download `.statechart.md`, or open directly in [mermaid.live](https://mermaid.live).
- **Options**:
  - Collapse error-sink edges (simplifies busy diagrams by collapsing transitions into error states to the composite border)
  - Include state descriptions (extracts text from `getStateDescription()`)
  - Live auto-refresh as you edit

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for web production
npm run build
```

## Build Windows 11 Desktop Executable (.exe)

You can package this app as a standalone Windows desktop app:

```powershell
# Build the Windows Installer and Portable .exe
npm run build:exe
```

The compiled executables will be output to the `release/` folder:
- **`TcPouStatechartGenerator Setup <version>.exe`** (Windows Installer)
- **`TcPouStatechartGenerator <version>.exe`** (Portable standalone executable — no installation required)

## Samples

Sample input and generated output files are included in the interactive app and under `/public/samples/`:
- `E_DoorDasher_States.TcDUT` / `SM_DoorDasher.TcPOU` / `SM_DoorDasher.statechart.md`
- `E_TableManager_States.TcDUT` / `SM_TableManager.TcPOU` / `SM_TableManager.statechart.md`
- `E_KMotorVFD_States.TcDUT` / `SM_KMotorVFDEtherCATi550.TcPOU`
- `E_KAnalogMeasure_States.TcDUT` / `SM_KAnalogMeasure.TcPOU` / `SM_KAnalogMeasure.statechart.md`
- `E_234FeedManager_States.TcDUT` / `SM_234FeedManager.TcPOU` / `SM_234FeedManager.statechart.md`
