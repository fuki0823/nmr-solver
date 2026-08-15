interface MolecularFormulaProps {
  formula: string;
  className?: string;
}

export default function MolecularFormula({
  formula,
  className,
}: MolecularFormulaProps) {
  const parts = formula.match(/[A-Za-z]+|\d+/g) ?? [formula];
  return (
    <span className={className}>
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? <sub key={i}>{part}</sub> : part,
      )}
    </span>
  );
}
