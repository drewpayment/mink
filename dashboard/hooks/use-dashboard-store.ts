import { create } from "zustand";
import type { OverviewPayload, TokenLedgerPayload, FileIndexPayload, DesignImagePayload } from "@mink/types/dashboard";
import type { LearningMemory } from "@mink/types/learning-memory";
import type { BugEntry } from "@mink/types/bug-memory";
import type { WasteFlag } from "@mink/types/waste-detection";
import type { TaskRunRecord, TaskDefinition, DeadLetterEntry } from "@mink/types/scheduler";

export interface ActionLogRow {
  time: string;
  action: string;
  files: string;
  outcome: string;
  tokens: string;
}

interface DashboardState {
  connected: boolean;
  overview: OverviewPayload | null;
  ledger: TokenLedgerPayload | null;
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

  setConnected: (v: boolean) => void;
  setOverview: (data: OverviewPayload) => void;
  setLedger: (data: TokenLedgerPayload) => void;
  setFileIndex: (data: FileIndexPayload) => void;
  setScheduler: (tasks: TaskRunRecord[], definitions: TaskDefinition[], deadLetters: DeadLetterEntry[]) => void;
  setHealth: (health: { uptimeMs: number } | null) => void;
  setLearningMemory: (data: LearningMemory) => void;
  setActionLog: (entries: ActionLogRow[]) => void;
  setBugs: (entries: BugEntry[]) => void;
  setWasteFlags: (flags: WasteFlag[]) => void;
  setDesignImages: (images: DesignImagePayload[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  connected: false,
  overview: null,
  ledger: null,
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

  setConnected: (v) => set({ connected: v }),
  setOverview: (data) => set({ overview: data }),
  setLedger: (data) => set({ ledger: data, wasteFlags: data.wasteFlags ?? [] }),
  setFileIndex: (data) => set({ fileIndex: data }),
  setScheduler: (tasks, definitions, deadLetters) => set({ tasks, taskDefinitions: definitions, deadLetters }),
  setHealth: (health) => set({ health }),
  setLearningMemory: (data) => set({ learningMemory: data }),
  setActionLog: (entries) => set({ actionLog: entries }),
  setBugs: (entries) => set({ bugs: entries }),
  setWasteFlags: (flags) => set({ wasteFlags: flags }),
  setDesignImages: (images) => set({ designImages: images }),
}));
