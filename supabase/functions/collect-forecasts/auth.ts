export type AuthClient = {
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};
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
): Promise<401 | 403 | { userId: string }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length <= 7) return 401;
  const { data, error } = await client.auth.getUser(header.slice(7));
  if (error || !data.user) return 401;
  return allowlist.has(data.user.id) ? { userId: data.user.id } : 403;
}
