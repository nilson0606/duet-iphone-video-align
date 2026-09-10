/** Vite replaces BASE_URL for each host; direct Node tests use the root. */
export function publicAsset(path: string): string {
  const base =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL ?? '/';
  return `${base}${path.replace(/^\/+/, '')}`;
}
