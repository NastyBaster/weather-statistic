export type AuthClient = {
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};
export type Authorization = { triggerType: "manual" | "scheduled" };

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
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
  if (constantTimeEqual(token, schedulerToken)) {
    return { triggerType: "scheduled" };
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return 401;
  return allowlist.has(data.user.id) ? { triggerType: "manual" } : 403;
}
