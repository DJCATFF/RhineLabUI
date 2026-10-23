import type {
  Facets,
  ImportProgress,
  ImportResult,
  IndexStatus,
  JobsSummary,
  ListParams,
  ListResult,
  ResourceDetail,
} from "./types";

export interface PdfProbeResult {
  ok: boolean;
  pages?: number;
  bytes?: number;
  renderMs?: number;
  textMs?: number;
  textLength?: number;
  textSample?: string;
  canvasCssWidth?: number;
  canvasCssHeight?: number;
  error?: string;
}

export interface DeskLibrary {
  info: () => Promise<{ path: string }>;
  list: (params: ListParams) => Promise<ListResult>;
  get: (id: string) => Promise<ResourceDetail | null>;
  facets: () => Promise<Facets>;
  update: (
    id: string,
    patch: { title?: string; favorite?: boolean; note?: string; inbox?: boolean },
  ) => Promise<ResourceDetail | null>;
  setTags: (id: string, names: string[]) => Promise<ResourceDetail | null>;
  setCollections: (id: string, ids: string[]) => Promise<ResourceDetail | null>;
  createCollection: (name: string) => Promise<string>;
  trash: (ids: string[]) => Promise<{ moved: number }>;
  restore: (ids: string[]) => Promise<{ restored: number }>;
  touch: (id: string) => Promise<boolean>;
  reading: (id: string, locator: string, progress: number) => Promise<{ ok: boolean }>;
  open: (id: string) => Promise<{ ok: boolean; error?: string }>;
  reveal: (id: string) => Promise<boolean>;
  importFolder: () => Promise<ImportResult>;
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
  jobs: () => Promise<JobsSummary>;
  rebuildIndex: () => Promise<{ indexed: number; status: IndexStatus }>;
  indexStatus: () => Promise<IndexStatus>;
  retryExtraction: (id: string) => Promise<{ queued: number; jobs: JobsSummary }>;
  retryFailedExtractions: () => Promise<{ queued: number; jobs: JobsSummary }>;
  onJobsChanged: (callback: (summary: JobsSummary) => void) => () => void;
}

declare global {
  interface Window {
    desk?: {
      pickFolder: () => Promise<string | null>;
      scan: (folder: string) => Promise<unknown>;
      hash: (file: string) => Promise<unknown>;
      worker: () => Promise<unknown>;
      reveal: (target: string) => Promise<boolean>;
      readFile: (file: string) => Promise<Uint8Array | null>;
      reportPdf: (result: PdfProbeResult) => Promise<boolean>;
      library: DeskLibrary;
    };
  }
}

export {};
