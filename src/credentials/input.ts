const PREFIX_ERROR =
  "Enter a registry host, optionally followed by a repository path, without a URL scheme or trailing slash.";

export function normalizePrefix(raw: string): string {
  const value = raw.trim();
  if (
    !value ||
    /\s|[?#\\]/.test(value) ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("@")
  ) {
    throw new Error(PREFIX_ERROR);
  }

  const slashIndex = value.indexOf("/");
  const hostInput = slashIndex === -1 ? value : value.slice(0, slashIndex);
  const path = slashIndex === -1 ? "" : value.slice(slashIndex + 1);
  const pathSegments = path ? path.split("/") : [];

  if (pathSegments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error(PREFIX_ERROR);
  }

  try {
    const parsed = new URL(`https://${hostInput}`);
    if (
      !hostInput ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(PREFIX_ERROR);
    }

    const explicitPort = hostInput.startsWith("[")
      ? hostInput.match(/^\[[^\]]+\]:(\d+)$/)?.[1]
      : hostInput.match(/:(\d+)$/)?.[1];
    const host = `${parsed.hostname}${explicitPort ? `:${explicitPort}` : ""}`;
    return path ? `${host}/${path}` : host;
  } catch {
    throw new Error(PREFIX_ERROR);
  }
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim();
  if (!username) throw new Error("Enter a username.");
  return username;
}

export function validateSecret(raw: string): string {
  if (!raw.trim()) throw new Error("Enter a password, personal access token, or secret.");
  return raw;
}
