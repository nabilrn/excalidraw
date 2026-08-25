# Excalidraw Local Workspace

A minimal React/Vite application that embeds the stable Excalidraw editor as a dependency.

## Baseline

- `@excalidraw/excalidraw`: `0.18.1` (exactly pinned)
- React 18
- TypeScript
- Vite

The Excalidraw upstream monorepo is intentionally not copied into this branch. Product features should be implemented in `src/` while Excalidraw remains an external stable drawing engine.

The previous full upstream fork, including the first todo/timer prototype, is preserved in the `legacy-excalidraw-fork` branch.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
