export type ChannelPlatform = "discord" | "telegram";

export interface ChannelPidFile {
  session: string;
  platform: ChannelPlatform;
  startedAt: string;
  vaultPath: string;
}

export interface ChannelStatus {
  session: string;
  platform: ChannelPlatform;
  startedAt: string;
  vaultPath: string;
  uptime: number;
}
