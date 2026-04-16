import {
  getOrCreateDeviceId,
  listDevices,
  setDeviceName,
} from "../core/device";
import { hostname, platform } from "os";

export function device(args: string[]): void {
  const sub = args[0] ?? "status";

  switch (sub) {
    case "status": {
      const id = getOrCreateDeviceId();
      const devices = listDevices();
      const current = devices.find((d) => d.id === id);
      console.log("[mink] device info:");
      console.log(`  id:        ${id}`);
      console.log(`  name:      ${current?.name ?? hostname()}`);
      console.log(`  hostname:  ${hostname()}`);
      console.log(`  platform:  ${platform()}`);
      if (current?.firstSeen) {
        console.log(`  first seen: ${current.firstSeen}`);
      }
      if (current?.lastSeen) {
        console.log(`  last seen:  ${current.lastSeen}`);
      }
      break;
    }

    case "list": {
      const devices = listDevices();
      const currentId = getOrCreateDeviceId();
      if (devices.length === 0) {
        console.log("[mink] no devices registered yet");
        return;
      }
      console.log("[mink] registered devices:");
      for (const d of devices) {
        const marker = d.id === currentId ? " (this device)" : "";
        console.log(`  ${d.name}${marker}`);
        console.log(`    id:       ${d.id}`);
        console.log(`    hostname: ${d.hostname}`);
        console.log(`    platform: ${d.platform}`);
        console.log(`    last seen: ${d.lastSeen}`);
      }
      break;
    }

    case "rename": {
      const name = args.slice(1).join(" ");
      if (!name) {
        console.error("Usage: mink device rename <name>");
        process.exit(1);
      }
      setDeviceName(name);
      console.log(`[mink] device renamed to "${name}"`);
      break;
    }

    default:
      console.error(`[mink] unknown device subcommand: ${sub}`);
      console.error("Usage: mink device [status|list|rename <name>]");
      process.exit(1);
  }
}
