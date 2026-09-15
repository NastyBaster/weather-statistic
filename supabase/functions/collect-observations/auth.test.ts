import { assert, assertEquals } from "@std/assert";
import { authorize, isValidSchedulerToken, parseAllowlist } from "./auth.ts";

const schedulerToken = "A".repeat(43);
const client = {
  auth: {
    getUser: (token: string) =>
      Promise.resolve({
        data: { user: token === "user-token" ? { id: "admin-1" } : null },
        error: token === "user-token" ? null : new Error("invalid token"),
      }),
  },
};

function request(token: string) {
  return new Request("https://example.test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

Deno.test("accepts a valid dedicated scheduler token", async () => {
  assert(isValidSchedulerToken(schedulerToken));
  assertEquals(
    await authorize(request(schedulerToken), client, new Set(), schedulerToken),
    { triggerType: "scheduled" },
  );
});

Deno.test("keeps manual allowlist authorization separate", async () => {
  assertEquals(
    await authorize(
      request("user-token"),
      client,
      parseAllowlist("admin-1"),
      schedulerToken,
    ),
    { triggerType: "manual" },
  );
  assertEquals(
    await authorize(request("user-token"), client, new Set(), schedulerToken),
    403,
  );
  assertEquals(
    await authorize(request("wrong-token"), client, new Set(), schedulerToken),
    401,
  );
});
