import { loadFromBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export async function deserializeScene(
  sceneData: string,
): Promise<ExcalidrawInitialDataState> {
  try {
    const blob = new Blob([sceneData], { type: "application/json" });
    const restored = await loadFromBlob(blob, null, null);

    return {
      elements: restored.elements ?? [],
      appState: restored.appState ?? {},
      files: restored.files ?? {},
      scrollToContent: true,
    };
  } catch {
    return {
      elements: [],
      appState: {},
      files: {},
    };
  }
}
