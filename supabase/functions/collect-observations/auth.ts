export type AuthClient = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
};

export async function authorizeManual(
  request: Request,
  client: AuthClient,
  allowlist: Set<string>,
): Promise<401 | 403 | true> {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer [^\s]+$/.test(header)) return 401;
  const { data, error } = await client.auth.getUser(header.slice(7));
  if (error || !data.user) return 401;
  return allowlist.has(data.user.id) ? true : 403;
}
