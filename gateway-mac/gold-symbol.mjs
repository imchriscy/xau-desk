/** 黄金品种名：XAUUSD / XAUUSDx / XAUUSDm / GOLD 等视为同一类。 */
export function normalizeGoldSymbol(symbol) {
  const s = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  if (s === "GOLD" || s.startsWith("XAU")) {
    const base = s.replace(/[XM]$/i, "").replace(/X$/i, "");
    if (base === "GOLD") return "XAUUSD";
    return base.startsWith("XAU") ? base.slice(0, 6) : "XAUUSD";
  }
  return s;
}

export function goldSymbolsMatch(a, b) {
  const na = normalizeGoldSymbol(a);
  const nb = normalizeGoldSymbol(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith("XAU") && nb.startsWith("XAU")) return true;
  return na === "XAUUSD" && nb === "XAUUSD";
}

function normKey(sym) {
  return String(sym || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function symbolsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (goldSymbolsMatch(a, b)) return true;
  return normKey(a) === normKey(b);
}

export function positionMatchesSymbol(positionSymbol, filterSymbol) {
  if (!filterSymbol) return true;
  if (positionSymbol === filterSymbol) return true;
  return symbolsMatch(positionSymbol, filterSymbol);
}
