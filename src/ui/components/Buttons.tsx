import type { JSX, ReactNode, CSSProperties } from 'react'

type ButtonProps = { onClick: () => void; children: ReactNode; disabled?: boolean }

const baseButton: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  // 15px text with 10px padding computed to a ~38px control — under the 44px minimum a thumb
  // needs. The floor is set here, on the shared base, so every button in the app clears it
  // rather than each call site remembering to.
  minHeight: 44,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
}

export function PrimaryButton({ onClick, children, disabled = false }: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseButton,
        background: disabled ? '#1e293b' : '#2563eb',
        color: disabled ? '#64748b' : 'white',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** Muted button for the destructive/retreating choice, so it never outshines the bet. */
export function SecondaryButton({
  onClick,
  children,
  disabled = false,
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseButton,
        background: 'transparent',
        color: disabled ? '#475569' : '#94a3b8',
        border: `1px solid ${disabled ? '#1e293b' : '#475569'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** One amber line of guidance under the felt or beside a control. */
export function Hint({ text }: { text: string }): JSX.Element {
  return <p style={{ color: '#fbbf24', fontSize: 14, marginTop: 16 }}>{text}</p>
}
