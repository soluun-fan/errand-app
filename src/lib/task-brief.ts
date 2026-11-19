/** A readable list title from the customer's message; the full request is kept as the description. */
export function titleFromBrief(message: string, max: number): string {
  const firstLine = message.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
  const text = firstLine.replace(/^[-•*]\s+(?=\S)/, "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  // The server's limit counts UTF-16 units. Never leave half an emoji at the cut.
  const cut = text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd();
}
