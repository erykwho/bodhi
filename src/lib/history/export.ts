export { sessionsToCsv, sessionsToJson } from "@bodhi/core/history/export";

/**
 * Triggers a browser file download for the generated CSV or JSON export.
 */
export function triggerFileDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
