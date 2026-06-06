import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type {
  StatsEvent,
  ToolCompletedEvent,
  ToolEventInput,
  ToolEventOutput,
} from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { Event } from "@opencode-ai/sdk";

interface ConverterModule {
  eventType: string;
  convert: (event: Event, directory: string) => StatsEvent | null;
}

const converters: Record<
  string,
  (event: Event, directory: string) => StatsEvent | null
> = {};

const require = createRequire(import.meta.url);
const convertersDir = join(import.meta.dir, "converters");
const files = readdirSync(convertersDir).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".d.ts"),
);

for (const file of files) {
  const mod: ConverterModule = require(join(convertersDir, file));
  if (mod.eventType && mod.convert) {
    converters[mod.eventType] = mod.convert;
  }
}

export function convertEvent(
  event: Event,
  directory: string,
): StatsEvent | null {
  const fn = converters[event.type];
  return fn ? fn(event, directory) : null;
}

export function convertToolEvent(
  input: ToolEventInput,
  output: ToolEventOutput,
  directory: string,
): ToolCompletedEvent {
  const m = output.metadata;
  return {
    ...createBaseEvent(),
    event_type: "tool.completed",
    session_id: input.sessionID,
    project_path: directory,
    tool_name: input.tool,
    call_id: input.callID,
    duration_ms: typeof m.duration_ms === "number" ? m.duration_ms : 0,
    title: output.title,
    tokens: m.tokens as ToolCompletedEvent["tokens"],
    cost_usd: typeof m.cost_usd === "number" ? m.cost_usd : 0,
  };
}
