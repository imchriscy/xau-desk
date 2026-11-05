export interface AccountProfile {
  id: string;
  label: string;
  login: number;
  server: string;
}

export interface AppSettings {
  /** 实盘账户：启用后 ARM + 下单走 MT5 */
  liveExecutionEnabled: boolean;
  /** 演示账户：勾选则市价也发送到 MT5 Demo */
  demoSendToMt5: boolean;
  profiles: AccountProfile[];
}

const KEY = "ming-win-trade-settings-v1";

export const DEFAULT_SETTINGS: AppSettings = {
  liveExecutionEnabled: true,
  demoSendToMt5: true,
  profiles: [],
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, profiles: [] };
    const parsed = JSON.parse(raw) as AppSettings;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      liveExecutionEnabled: true,
      demoSendToMt5: true,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function newProfileId(): string {
  return `acc-${Date.now().toString(36)}`;
}
