export type SheetLinkResult = { ok: true; exportUrl: string } | { ok: false; message: string };

const NOT_A_SHEET = "Paste a Google Sheets link, like https://docs.google.com/spreadsheets/d/…/edit";

/**
 * Turns a Google Sheets link into its CSV export URL. Keeps the tab (gid) the link points at.
 * Supports normal share links (/d/<id>/…) and "Publish to web" links (/d/e/<id>/pub…).
 */
export function sheetCsvExportUrl(link: string): SheetLinkResult {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return { ok: false, message: NOT_A_SHEET };
  }
  if (url.hostname !== "docs.google.com") return { ok: false, message: NOT_A_SHEET };

  const gid = url.searchParams.get("gid") ?? /(?:^|[#&])gid=(\d+)/.exec(url.hash)?.[1] ?? null;
  const gidParam = gid && /^\d+$/.test(gid) ? `&gid=${gid}` : "";

  const published = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  if (published) {
    return {
      ok: true,
      exportUrl: `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gidParam}`,
    };
  }
  const shared = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  if (shared) {
    return { ok: true, exportUrl: `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=csv${gidParam}` };
  }
  return { ok: false, message: NOT_A_SHEET };
}

/** Hosts the CSV export may redirect through. Anything else (e.g. accounts.google.com) = not public. */
export function isAllowedSheetHost(hostname: string): boolean {
  return hostname === "docs.google.com" || hostname.endsWith(".googleusercontent.com");
}
