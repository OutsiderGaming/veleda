// Whether this browser is in the launch preview. Separate from preview.tsx so the session, which sits
// above the preview provider, can read it too.
export const PREVIEW_MODE_KEY = "veleda.preview";

export function launchPreviewOn(): boolean {
  const param = new URLSearchParams(location.search).get("preview");
  try {
    if (param === "launch") localStorage.setItem(PREVIEW_MODE_KEY, "launch");
    if (param === "off") localStorage.removeItem(PREVIEW_MODE_KEY);
    return param === "launch" || (param !== "off" && localStorage.getItem(PREVIEW_MODE_KEY) === "launch");
  } catch {
    return param === "launch";
  }
}
