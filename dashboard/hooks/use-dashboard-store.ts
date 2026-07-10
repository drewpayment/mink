import { create } from "zustand";
import type { OverviewPayload, TokenLedgerPayload, CompressionPayload, FileIndexPayload, DesignImagePayload, ConfigPanelPayload, SyncPanelPayload, ChannelPanelPayload, WikiPanelPayload, WikiNotePayload } from "@mink/types/dashboard";
import type { LearningMemory } from "@mink/types/learning-memory";
import type { BugEntry } from "@mink/types/bug-memory";
import type { WasteFlag } from "@mink/types/waste-detection";
import type { TaskRunRecord, TaskDefinition, DeadLetterEntry } from "@mink/types/scheduler";
import type { RegisteredProject } from "@/types/project";

export interface ActionLogRow {
  time: string;
  /** Full UTC instant (ISO) reconstructed from the session date + row time, when available. */
  iso?: string;
  action: string;
  files: string;
  outcome: string;
  tokens: string;
}

interface DashboardState {
  connected: boolean;
  projects: RegisteredProject[];
  activeProjectId: string | null;
  overview: OverviewPayload | null;
  ledger: TokenLedgerPayload | null;
  compression: CompressionPayload | null;
  fileIndex: FileIndexPayload | null;
  tasks: TaskRunRecord[];
  taskDefinitions: TaskDefinition[];
  deadLetters: DeadLetterEntry[];
  health: { uptimeMs: number } | null;
  learningMemory: LearningMemory | null;
  actionLog: ActionLogRow[];
  bugs: BugEntry[];
  wasteFlags: WasteFlag[];
  designImages: DesignImagePayload[];
  config: ConfigPanelPayload | null;
  sync: SyncPanelPayload | null;
  channel: ChannelPanelPayload | null;
  wiki: WikiPanelPayload | null;
  wikiNote: WikiNotePayload | null;

  setConnected: (v: boolean) => void;
  setProjects: (projects: RegisteredProject[], activeId: string) => void;
  setActiveProject: (id: string) => void;
  setOverview: (data: OverviewPayload) => void;
  setLedger: (data: TokenLedgerPayload) => void;
  setCompression: (data: CompressionPayload) => void;
  setFileIndex: (data: FileIndexPayload) => void;
  setScheduler: (tasks: TaskRunRecord[], definitions: TaskDefinition[], deadLetters: DeadLetterEntry[]) => void;
  setHealth: (health: { uptimeMs: number } | null) => void;
  setLearningMemory: (data: LearningMemory) => void;
  setActionLog: (entries: ActionLogRow[]) => void;
  setBugs: (entries: BugEntry[]) => void;
  setWasteFlags: (flags: WasteFlag[]) => void;
  setDesignImages: (images: DesignImagePayload[]) => void;
  setConfig: (data: ConfigPanelPayload) => void;
  setSync: (data: SyncPanelPayload) => void;
  setChannel: (data: ChannelPanelPayload) => void;
  setWiki: (data: WikiPanelPayload) => void;
  setWikiNote: (data: WikiNotePayload | null) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  connected: false,
  projects: [],
  activeProjectId: null,
  overview: null,
  ledger: null,
  compression: null,
  fileIndex: null,
  tasks: [],
  taskDefinitions: [],
  deadLetters: [],
  health: null,
  learningMemory: null,
  actionLog: [],
  bugs: [],
  wasteFlags: [],
  designImages: [],
  config: null,
  sync: null,
  channel: null,
  wiki: null,
  wikiNote: null,

  setConnected: (v) => set({ connected: v }),
  setProjects: (projects, activeId) => set({ projects, activeProjectId: activeId }),
  setActiveProject: (id) =>
    set({
      activeProjectId: id,
      overview: null,
      ledger: null,
      compression: null,
      fileIndex: null,
      tasks: [],
      taskDefinitions: [],
      deadLetters: [],
      health: null,
      learningMemory: null,
      actionLog: [],
      bugs: [],
      wasteFlags: [],
      designImages: [],
    }),
  setOverview: (data) => set({ overview: data }),
  setLedger: (data) => set({ ledger: data, wasteFlags: data.wasteFlags ?? [] }),
  setCompression: (data) => set({ compression: data }),
  setFileIndex: (data) => set({ fileIndex: data }),
  setScheduler: (tasks, definitions, deadLetters) => set({ tasks, taskDefinitions: definitions, deadLetters }),
  setHealth: (health) => set({ health }),
  setLearningMemory: (data) => set({ learningMemory: data }),
  setActionLog: (entries) => set({ actionLog: entries }),
  setBugs: (entries) => set({ bugs: entries }),
  setWasteFlags: (flags) => set({ wasteFlags: flags }),
  setDesignImages: (images) => set({ designImages: images }),
  setConfig: (data) => set({ config: data }),
  setSync: (data) => set({ sync: data }),
  setChannel: (data) => set({ channel: data }),
  setWiki: (data) => set({ wiki: data }),
  setWikiNote: (data) => set({ wikiNote: data }),
}));
