export function buildLibrary<T>(accountBuilds: readonly T[], publicBuilds: readonly T[], signedIn: boolean): readonly T[] {
  return signedIn ? accountBuilds : publicBuilds;
}
