export const colors = { forest: "#075b2a", leaf: "#3b8c45", navy: "#0d1f6d", gold: "#f3ab20", canvas: "#f7faf7", panel: "#ffffff", ink: "#101a38", muted: "#667085", danger: "#c62828", border: "#dfe7df" } as const;
export const radius = { sm: 8, md: 14, lg: 22 } as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export function formatScore(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "—";
}
