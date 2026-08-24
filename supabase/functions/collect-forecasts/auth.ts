export type AuthClient = {
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};
export type Authorization = { triggerType: "manual" | "scheduled" };

const SCHEDULER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidSchedulerToken(
  value: string | undefined,
): value is string {
  if (!value || !SCHEDULER_TOKEN_PATTERN.test(value)) return false;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
  try {
    return Uint8Array.from(
      atob(normalized),
      (character) => character.charCodeAt(0),
    ).length === 32;
  } catch {
    return false;
  }
}

function constantTimeSchedulerTokenEqual(left: string, right: string): boolean {
  if (!SCHEDULER_TOKEN_PATTERN.test(left)) return false;
  let difference = 0;
  for (let index = 0; index < 43; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}
export async function authorize(
  request: Request,
  client: AuthClient,
  allowlist: Set<string>,
  schedulerToken: string,
): Promise<401 | 403 | Authorization> {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer [^\s]+$/.test(header)) return 401;
  const token = header.slice(7);
  if (constantTimeSchedulerTokenEqual(token, schedulerToken)) {
    return { triggerType: "scheduled" };
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return 401;
  return allowlist.has(data.user.id) ? { triggerType: "manual" } : 403;
}
