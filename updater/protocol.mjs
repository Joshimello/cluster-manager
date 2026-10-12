export const imageRepository = "ghcr.io/joshimello/cluster-manager-platform";
export const stablePattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newer(source, target) {
  if (!stablePattern.test(source) || !stablePattern.test(target)) return false;
  const left = source.slice(1).split(".").map(BigInt),
    right = target.slice(1).split(".").map(BigInt);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return right[i] > left[i];
  return false;
}
export function parseOperation(body) {
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      body.id,
    ) ||
    typeof body.sourceVersion !== "string" ||
    typeof body.targetVersion !== "string" ||
    !newer(body.sourceVersion, body.targetVersion) ||
    typeof body.resume !== "boolean" ||
    typeof body.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.expiresAt))
  )
    return null;
  return {
    id: body.id,
    sourceVersion: body.sourceVersion,
    targetVersion: body.targetVersion,
    expiresAt: body.expiresAt,
    resume: body.resume,
  };
}
export async function verifyRelease(version) {
  if (!stablePattern.test(version)) throw new Error("release_unavailable");
  const response = await fetch(
    `https://api.github.com/repos/Joshimello/cluster-manager/releases/tags/${version}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "cluster-manager-updater",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error("release_unavailable");
  const text = await response.text();
  if (text.length > 512_000) throw new Error("release_unavailable");
  const release = JSON.parse(text);
  if (
    release.tag_name !== version ||
    release.draft !== false ||
    release.prerelease !== false ||
    !release.published_at
  )
    throw new Error("release_unavailable");
}
