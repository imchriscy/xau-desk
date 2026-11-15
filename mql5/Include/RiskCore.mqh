//+------------------------------------------------------------------+
//| RiskCore.mqh · 热路径闸门（Phase 0 精简）                         |
//+------------------------------------------------------------------+
#ifndef __XAU_RISK_CORE_MQH__
#define __XAU_RISK_CORE_MQH__

static bool g_armed        = false;
static bool g_halted       = false;
static bool g_require_sl   = true;
static bool g_allow_demo   = true;

void RiskSetRequireSl(const bool v) { g_require_sl = v; }
void RiskSetAllowDemo(const bool v) { g_allow_demo = v; }
void RiskSetArmed(const bool v) { if(!g_halted) g_armed = v; }
void RiskSetHalted(const bool v) { g_halted = v; if(v) g_armed = false; }
bool RiskIsArmed()  { return g_armed && !g_halted; }
bool RiskIsHalted() { return g_halted; }

bool RiskPrecheckMarket(const bool is_buy, const double sl, string &err)
{
   if(g_halted) { err = "halted"; return false; }
   if(!g_armed) { err = "disarmed"; return false; }
   if(g_require_sl && sl <= 0) { err = "require_stop_loss"; return false; }
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode != ACCOUNT_TRADE_MODE_REAL && !g_allow_demo) { err = "demo_blocked"; return false; }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) { err = "terminal_trade_off"; return false; }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED)) { err = "ea_trade_off"; return false; }
   return true;
}

bool RiskPrecheckClose(string &err)
{
   if(g_halted) { err = "halted"; return false; }
   if(!g_armed) { err = "disarmed"; return false; }
   return true;
}

#endif
