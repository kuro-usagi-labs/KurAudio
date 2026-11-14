import { Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
export function CheckField({ checked, disabled = false, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return <label className="check-field"><span className="checkbox-control"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}/><span className="checkbox-box" aria-hidden="true"><Check size={12} weight="bold"/></span></span><span>{children}</span></label>;
}
