/**
 * Strips sub_components from component arrays when deep composition
 * capture is disabled (operator privacy control).
 */
export function stripSubComponents<T extends { sub_components?: unknown }>(
  arr: T[] | undefined,
  deep: boolean,
): T[] | undefined {
  if (!arr) return arr;
  if (deep) return arr;
  return arr.map((c) => {
    const { sub_components: _, ...rest } = c;
    return rest as T;
  });
}
