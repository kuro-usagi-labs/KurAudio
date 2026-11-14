import './toggle-switch.css';

export function ToggleSwitch({ label, checked, onChange, disabled = false, controls }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; controls?: string;
}) {
  return <span className="toggle-switch">
    <input type="checkbox" role="switch" aria-label={label} aria-checked={checked} aria-controls={controls} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb"/></span>
  </span>;
}
