import { HttpError } from "../utils/errors.js";
export async function artifactRequest(
  url: string | URL,
  options: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch {
    throw new HttpError(
      502,
      "ARTIFACT_UNAVAILABLE",
      "Artifact request failed; retry later",
    );
  }
}
