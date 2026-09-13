import { HttpError } from "../utils/errors.js";
export function artifactDownloadUrl(value: string | null): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new HttpError(
      502,
      "ARTIFACT_UNAVAILABLE",
      "GitHub returned an invalid artifact download URL",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !(
      url.hostname.endsWith(".blob.core.windows.net") ||
      url.hostname.endsWith(".actions.githubusercontent.com")
    )
  )
    throw new HttpError(
      502,
      "ARTIFACT_UNAVAILABLE",
      "Unsupported artifact storage host",
    );
  return url;
}
