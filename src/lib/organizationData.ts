export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};
/** Explicit paging avoids PostgREST silently truncating a large roster or connection list. */
export async function collectOrganizationPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const result: T[] = [];
  const pageSize = 200;
  for (;;) {
    const page = await fetchPage(result.length, result.length + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    result.push(...rows);
    if (
      !rows.length ||
      (page.count != null
        ? result.length >= page.count
        : rows.length < pageSize)
    )
      return result;
  }
}
export function organizationError(cause: unknown, fallback: string): string {
  return cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
    ? cause.message
    : fallback;
}
