export const originalDateNow = Date.now;
export const originalRandomUUID = crypto.randomUUID;

export function installDeterministicBaseEvent(): void {
  Date.now = () => 1_700_000_000_000;
  crypto.randomUUID = () => "00000000-0000-4000-8000-000000000001";
}

export function restoreBaseEventGlobals(): void {
  Date.now = originalDateNow;
  crypto.randomUUID = originalRandomUUID;
}

export const deterministicBase = {
  event_id: "00000000-0000-4000-8000-000000000001",
  created_at_ms: 1_700_000_000_000,
};
