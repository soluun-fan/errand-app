/** Decorative stand-in for a QPay QR code (not scannable). */
export function MockQr({ seed }: { seed: string }) {
  const n = 21;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const finder = (r: number, c: number) => {
    const inBox = (r0: number, c0: number) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      if (inBox(r0, c0)) {
        const rr = r - r0;
        const cc = c - c0;
        return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
      }
    }
    return null;
  };
  const cells: boolean[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const f = finder(r, c);
      h = (h * 1103515245 + 12345) >>> 0;
      cells.push(f ?? ((h >>> 16) & 1) === 1);
    }
  return (
    <svg role="img" aria-label="QPay QR code (demo)" viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="h-40 w-40 rounded-lg border border-line bg-white">
      {cells.map((on, i) => (on ? <rect key={i} x={i % n} y={Math.floor(i / n)} width={1} height={1} fill="#18181b" /> : null))}
    </svg>
  );
}
