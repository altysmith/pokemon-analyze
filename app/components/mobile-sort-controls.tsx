"use client";

type SortDirection = "asc" | "desc";

export function MobileSortControls<Key extends string>({
  id,
  label,
  options,
  sort,
  onSelect,
  onToggle,
}: {
  id: string;
  label: string;
  options: ReadonlyArray<{ key: Key; label: string }>;
  sort: { key: Key; direction: SortDirection };
  onSelect: (key: Key) => void;
  onToggle: () => void;
}) {
  return <div className="mb-3 flex items-end gap-2 md:hidden">
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">{label}</label>
      <select id={id} value={sort.key} onChange={(event) => onSelect(event.target.value as Key)} className="min-h-11 w-full rounded-lg border border-[#bfc8c9] bg-white px-3 text-sm text-[#1b2930] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </div>
    <button type="button" onClick={onToggle} aria-label={`Sort ${sort.direction === "asc" ? "ascending" : "descending"}; change direction`} className="min-h-11 rounded-lg border border-[#bfc8c9] bg-white px-3 text-sm font-semibold text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
      {sort.direction === "asc" ? "Ascending ↑" : "Descending ↓"}
    </button>
  </div>;
}
