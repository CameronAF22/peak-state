// One safety line for every screen (README.md safety boundary). Never per-screen copy.
export const SAFETY_LINE =
  "Peak State is a performance and state-recall tool. It is not therapy, diagnosis or a crisis service. If anything here feels distressing, stop and reach out to a person you trust.";

export function SafetyFooter({ onStop }: { onStop(): void }) {
  return (
    <footer className="safety" role="contentinfo">
      <p>{SAFETY_LINE}</p>
      <button className="stop" onClick={onStop} aria-label="Stop everything">
        Stop
      </button>
    </footer>
  );
}
