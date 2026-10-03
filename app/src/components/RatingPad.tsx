export function RatingPad({ prompt, onRate }: { prompt: string; onRate(n: number): void }) {
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div>{prompt}</div>
      <div className="rate-pad" role="group" aria-label="Rating from 0 to 10">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} onClick={() => onRate(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
