export const INVALID_REQUEST_REASONS = Object.freeze([
  "unsupported_content_type",
  "forbidden_request_header",
  "invalid_json",
  "body_must_be_object",
  "body_must_be_empty",
]);

export function classifyRequestShape(
  { contentTypeValid, forbiddenHeader, bodyText },
) {
  if (!contentTypeValid) return "unsupported_content_type";
  if (forbiddenHeader) return "forbidden_request_header";
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return "invalid_json";
  }
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return "body_must_be_object";
  }
  return Object.keys(body).length === 0 ? null : "body_must_be_empty";
}
