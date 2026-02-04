import { pushLog } from "./storage";

export function logEvent(type: string, payload?: unknown): void {
  pushLog({ ts: new Date().toISOString(), type, payload });
}
