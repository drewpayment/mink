import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { hostname, platform } from "os";
import { randomUUID } from "crypto";
import { deviceIdPath, deviceRegistryPath } from "./paths";
import { safeReadJson, atomicWriteJson } from "./fs-utils";
import type { DeviceInfo, DeviceRegistry } from "../types/config";

export function getOrCreateDeviceId(): string {
  const idPath = deviceIdPath();
  if (existsSync(idPath)) {
    return readFileSync(idPath, "utf-8").trim();
  }
  const id = randomUUID();
  mkdirSync(dirname(idPath), { recursive: true });
  writeFileSync(idPath, id + "\n");
  return id;
}

export function loadDeviceRegistry(): DeviceRegistry {
  const raw = safeReadJson(deviceRegistryPath());
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "devices" in (raw as object)) {
    return raw as DeviceRegistry;
  }
  return { devices: {} };
}

export function saveDeviceRegistry(registry: DeviceRegistry): void {
  atomicWriteJson(deviceRegistryPath(), registry);
}

export function updateDeviceHeartbeat(): void {
  const id = getOrCreateDeviceId();
  const registry = loadDeviceRegistry();
  const now = new Date().toISOString();
  const existing = registry.devices[id];

  registry.devices[id] = {
    name: existing?.name ?? hostname(),
    hostname: hostname(),
    platform: platform(),
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };

  saveDeviceRegistry(registry);
}

export function listDevices(): Array<DeviceInfo & { id: string }> {
  const registry = loadDeviceRegistry();
  return Object.entries(registry.devices).map(([id, info]) => ({
    id,
    ...info,
  }));
}

export function setDeviceName(name: string): void {
  const id = getOrCreateDeviceId();
  const registry = loadDeviceRegistry();
  const now = new Date().toISOString();
  const existing = registry.devices[id];

  registry.devices[id] = {
    name,
    hostname: hostname(),
    platform: platform(),
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };

  saveDeviceRegistry(registry);
}
