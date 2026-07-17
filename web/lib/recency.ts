// FIX 2 (recency-weighting): a shared age label attached to journal/product
// history fed into any AI route giving advice, so the model treats an old
// entry as background rather than current state. Deliberately just three
// coarse bands, not a decay score/confidence model — this app's scope
// doesn't need more than "is this still likely true."
export function ageLabel(dateStr: string): string {
  const days = Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 14) return "recent";
  if (days <= 60) return "older — background only unless asked about history";
  return "old — background only, may be outdated, unless asked about history/trends";
}

export const RECENCY_PROMPT_NOTE =
  " Entries/products/scans labeled 'older' or 'old' are background context only — they show what used to be true, not necessarily what's true now. Only treat something as the user's CURRENT state/routine if it's labeled 'recent', or the user is explicitly asking about history/trends. If an old and a recent entry conflict (e.g. an old entry praising a product they've since stopped), the recent one wins.";
