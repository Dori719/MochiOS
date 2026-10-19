/**
 * The line shown after a slash command runs.
 *
 * The engine's panel was Tailwind chrome built on `--marinara-chat-chrome-*`
 * variables that SillyTavern does not define; the port renders the same content
 * with the Mochi OS tokens instead, so it looks like the rest of the phone.
 */
import { SquareTerminal, X } from 'lucide-react';

interface SlashCommandFeedbackProps {
  feedback: string;
  onDismiss: () => void;
  className?: string;
}

/** Split "Label — detail" so the label can carry the emphasis. */
function splitDetail(line: string): { label: string; detail: string } {
  const match = /\s(?:\u2014|-)\s/.exec(line);
  if (!match) return { label: line.trim(), detail: '' };
  return {
    label: line.slice(0, match.index).trim(),
    detail: line.slice(match.index + match[0].length).trim(),
  };
}

export function SlashCommandFeedback({ feedback, onDismiss, className }: SlashCommandFeedbackProps) {
  const lines = feedback.split('\n');
  return (
    <div className={`mochi-slash-feedback ${className ?? ''}`}>
      <div className="mochi-slash-feedback-head">
        <span className="mochi-slash-feedback-title">
          <SquareTerminal size={13} />
          Command
        </span>
        <button type="button" title="Dismiss" onClick={onDismiss}>
          <X size={13} />
        </button>
      </div>
      <div className="mochi-slash-feedback-body">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={index} className="mochi-slash-feedback-gap" />;
          if (trimmed.startsWith('Tip:')) {
            return (
              <p key={index} className="mochi-slash-feedback-tip">
                {trimmed}
              </p>
            );
          }
          if (trimmed.endsWith(':') && !trimmed.startsWith('/') && !trimmed.startsWith('{{')) {
            return (
              <div key={index} className="mochi-slash-feedback-heading">
                {trimmed.slice(0, -1)}
              </div>
            );
          }
          const { label, detail } = splitDetail(trimmed);
          return (
            <div key={index} className="mochi-slash-feedback-line">
              <span className="mochi-slash-feedback-label">{label}</span>
              {detail && <span className="mochi-slash-feedback-detail">{detail}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
