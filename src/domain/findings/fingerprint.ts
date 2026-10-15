/**
 * Stable identity for "the same problem" across audits: category + main file + the title's key words.
 * Imperfect by design (reworded titles can create a new finding), but it stops the common case of
 * every audit re-adding identical findings, and it never merges findings from different files.
 */
export function fingerprint(category: string, title: string, mainFile: string | null): string {
  const words = title
    // Locale-free lowercase (Turkish locale would turn "I" into dotless "ı"), then strip accents.
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 6)
  return `${category}|${mainFile ?? '-'}|${words.join('-')}`
}
