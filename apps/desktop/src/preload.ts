import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desk", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("probe:pick-folder"),
  scan: (folder: string): Promise<unknown> => ipcRenderer.invoke("probe:scan", folder),
  hash: (file: string): Promise<unknown> => ipcRenderer.invoke("probe:hash", file),
  worker: (): Promise<unknown> => ipcRenderer.invoke("probe:worker"),
  reveal: (target: string): Promise<boolean> => ipcRenderer.invoke("probe:reveal", target),
  readFile: (file: string): Promise<Uint8Array> => ipcRenderer.invoke("file:read", file),
  reportPdf: (result: unknown): Promise<boolean> => ipcRenderer.invoke("probe:report-pdf", result),
  library: {
    info: (): Promise<{ path: string }> => ipcRenderer.invoke("library:info"),
    list: (params: unknown): Promise<unknown> => ipcRenderer.invoke("library:list", params),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke("library:get", id),
    facets: (): Promise<unknown> => ipcRenderer.invoke("library:facets"),
    update: (id: string, patch: unknown): Promise<unknown> => ipcRenderer.invoke("library:update", id, patch),
    setTags: (id: string, names: string[]): Promise<unknown> => ipcRenderer.invoke("library:tags", id, names),
    setCollections: (id: string, ids: string[]): Promise<unknown> =>
      ipcRenderer.invoke("library:collections", id, ids),
    createCollection: (name: string): Promise<string> => ipcRenderer.invoke("library:create-collection", name),
    trash: (ids: string[]): Promise<unknown> => ipcRenderer.invoke("library:trash", ids),
    restore: (ids: string[]): Promise<unknown> => ipcRenderer.invoke("library:restore", ids),
    touch: (id: string): Promise<boolean> => ipcRenderer.invoke("library:touch", id),
    reading: (id: string, locator: string, progress: number): Promise<unknown> =>
      ipcRenderer.invoke("library:reading", id, locator, progress),
    open: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("library:open", id),
    reveal: (id: string): Promise<boolean> => ipcRenderer.invoke("library:reveal", id),
    importFolder: (): Promise<unknown> => ipcRenderer.invoke("library:import"),
    onImportProgress: (callback: (progress: unknown) => void): (() => void) => {
      const listener = (_event: unknown, progress: unknown) => callback(progress);
      ipcRenderer.on("library:import-progress", listener);
      return () => ipcRenderer.removeListener("library:import-progress", listener);
    },
  },
});
