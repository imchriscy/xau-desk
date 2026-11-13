/** 与成长记录第 47 页同步 · 硬风控十条 */

export type SinPoison = "tan" | "chen" | "chi" | "man" | "yi";

export interface HardRiskOrdinanceRule {
  id: number;
  poem: string;
  sins: SinPoison[];
  sevenDeadly: string;
  title: string;
  detail: string;
  warn: string;
}

export const HARD_RISK_ORDINANCE: HardRiskOrdinanceRule[] = [
  {
    id: 1,
    poem: "盘中取金",
    sins: ["tan"],
    sevenDeadly: "贪婪",
    title: "禁止盘中「金库 → 交易户」转出",
    detail: "库→战每自然日最多 1 次，仅日终签章、无持仓、未触日损后执行。盘中补弹匣一律违纪。",
    warn: "11/11 FM700 · 贪念「再多一发子弹就能翻本」。",
  },
  {
    id: 2,
    poem: "亏空禁库",
    sins: ["chen"],
    sevenDeadly: "暴怒",
    title: "禁止子户当日亏完/日损封顶后，当日再动金库",
    detail: "交易栈打穿后，当天不得再从金库分配；仅下一交易日可按风控比例再分配。",
    warn: "嗔火「今天必须扳回来」· 越掏库越亡国。",
  },
  {
    id: 3,
    poem: "掌上观盘",
    sins: ["chi"],
    sevenDeadly: "色欲",
    title: "禁止手机端买卖与内转",
    detail: "手机 MT5/券商 App 只读；连点、追单、随时转账通道物理关闭。",
    warn: "迷恋触感与即时反馈 · 痴于那一戳下单。",
  },
  {
    id: 4,
    poem: "惟台是门",
    sins: ["chi"],
    sevenDeadly: "懒惰",
    title: "禁止绕过 XauDesk 下单",
    detail: "全部开平经 XauDesk；连亏/日损暂停期间禁止赌气开仓。",
    warn: "抄近路 = 懒与痴 · 403 笔多从宽门流入。",
  },
  {
    id: 5,
    poem: "无盾莫出",
    sins: ["chi"],
    sevenDeadly: "暴食",
    title: "禁止无止损开仓",
    detail: "强制 SL 常开；禁止手痒单、禁止先开仓后「再挂」。",
    warn: "无 SL 即裸奔吞风险。",
  },
  {
    id: 6,
    poem: "损莫南移",
    sins: ["man"],
    sevenDeadly: "傲慢",
    title: "禁止扩大止损 / 拖动 SL 远离风险",
    detail: "仅允许向收紧、利减损方向移动；放大风险 = 应届违纪。",
    warn: "慢傲「我不可能错」· 止损只能北不能南。",
  },
  {
    id: 7,
    poem: "洪潮莫扑",
    sins: ["chen", "tan"],
    sevenDeadly: "暴怒",
    title: "禁止逆势密集抄底、连亏后加仓报复",
    detail: "禁止狂点抄底；连亏停盘期间禁止任何地方补单。",
    warn: "嗔贪双煞 · 抄底幻想 + 连亏加手。",
  },
  {
    id: 8,
    poem: "触顶封刀",
    sins: ["chen"],
    sevenDeadly: "暴怒",
    title: "禁止日损/日窗封顶后继续交易",
    detail: "触发当日累计亏损上限后当日封盘，不许「再试一手」。",
    warn: "日损触顶仍战 = 嗔念未收。",
  },
  {
    id: 9,
    poem: "莫信必回",
    sins: ["man"],
    sevenDeadly: "傲慢",
    title: "禁止傲慢扛单",
    detail: "禁止「肯定能回来」式扛单、取消 SL。",
    warn: "慢傲「我比市场聪明」。",
  },
  {
    id: 10,
    poem: "窗内勿改",
    sins: ["yi"],
    sevenDeadly: "傲慢",
    title: "禁止本交易窗内篡改已锁定风控参数",
    detail: "盘中不得降日损、放宽连亏档位「救场」。",
    warn: "疑规则于我不合 · 改参 = 不信金生水泥板。",
  },
];

export const SIN_POISON_LABEL: Record<SinPoison, string> = {
  tan: "贪",
  chen: "嗔",
  chi: "痴",
  man: "慢",
  yi: "疑",
};
