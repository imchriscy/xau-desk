/** EA xau_state.json 内 bridge_ver 与网关能力对齐 */
export const REQUIRED_BRIDGE_VER = "1.023";

export function parseBridgeVer(v) {
  const m = String(v ?? "0").match(/^(\d+)\.(\d+)/);
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

export function bridgeVerAtLeast(actual, required = REQUIRED_BRIDGE_VER) {
  const [am, an] = parseBridgeVer(actual);
  const [rm, rn] = parseBridgeVer(required);
  return am > rm || (am === rm && an >= rn);
}