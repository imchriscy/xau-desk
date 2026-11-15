import type { TradeInstrument, TradeInstrumentId } from "../instruments";

interface Props {
  value: TradeInstrumentId;
  list: TradeInstrument[];
  onChange: (id: TradeInstrumentId) => void;
  disabled?: boolean;
}

export default function InstrumentPicker({ value, list, onChange, disabled }: Props) {
  return (
    <div className="instrument-picker" role="group" aria-label="交易品种">
      {list.map((inst) => (
        <button
          key={inst.id}
          type="button"
          className={`instrument-chip${value === inst.id ? " active" : ""}`}
          disabled={disabled}
          title={inst.label}
          onClick={() => onChange(inst.id)}
        >
          {inst.short}
        </button>
      ))}
    </div>
  );
}