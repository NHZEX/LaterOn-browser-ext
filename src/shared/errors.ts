// Native APIs and callbacks can reject with errors from another realm or plain objects.
export function errorText(error: unknown): string | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" ? message : undefined;
}
