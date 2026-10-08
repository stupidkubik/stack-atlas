type DailyDownloads = readonly { readonly day: string; readonly downloads: number }[];

/** The chart and its table share the retained, dated last-valid npm series. */
export function DownloadsSparkline({ series }: { readonly series: DailyDownloads | null }) {
  if (!series || series.length < 2 || series.some(({ downloads }) => !Number.isSafeInteger(downloads) || downloads < 0)) return null;
  const values = series.map(({ downloads }) => downloads);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const points = values.map((value, index) => {
    const x = 4 + (index * 232) / (values.length - 1);
    const y = maximum === minimum ? 32 : 60 - ((value - minimum) * 56) / (maximum - minimum);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return <figure className="mt-4">
    <svg viewBox="0 0 240 64" className="h-16 w-full text-sky-800" role="img" aria-label={`Daily package downloads from ${series[0].day} to ${series[series.length - 1].day}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
    <figcaption className="mt-2 text-sm text-slate-600">Daily downloads for the selected package, not total CMS usage.</figcaption>
    <details className="mt-2 text-sm"><summary className="cursor-pointer underline underline-offset-4">View daily download values</summary>
      <table className="mt-2 w-full text-left"><caption className="sr-only">Daily package downloads (UTC)</caption><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Downloads</th></tr></thead><tbody>{series.map(({ day, downloads }) => <tr key={day}><th scope="row" className="font-normal">{day}</th><td>{downloads}</td></tr>)}</tbody></table>
    </details>
  </figure>;
}
