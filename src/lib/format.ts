export function formatNumber(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("vi-VN").format(value);
}
