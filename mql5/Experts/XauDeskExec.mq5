//+------------------------------------------------------------------+
//| XauDeskExec.mq5 · Path A 执行 EA（热键 + TCP 快通道）             |
//+------------------------------------------------------------------+
#property copyright "XauDesk"
#property version   "1.020"

#include <TradeExec.mqh>
#include <RiskCore.mqh>
#include <StatePublish.mqh>
#include <FastLane.mqh>

input string InpSymbol           = "";
input int    InpMagic            = 8805190;
input int    InpFastPort         = 5192;
input int    InpTimerMs          = 5;
input int    InpStateEveryMs     = 200;
input double InpDefaultSlPoints  = 500;
input double InpLots1            = 0.01;
input double InpLots2            = 0.02;
input double InpLots3            = 0.05;
input bool   InpRequireSL        = true;
input bool   InpAllowDemo        = true;

double g_lots = 0.01;
ulong  g_last_state_ms = 0;

ulong CloseLatestAppTicket()
{
   ulong best = 0;
   long  best_t = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_sym) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      long ot = PositionGetInteger(POSITION_TIME);
      if(ot >= best_t) { best_t = ot; best = ticket; }
   }
   return best;
}

void FireMarket(const bool is_buy)
{
   string err = "";
   double sl = DefaultSlPrice(is_buy, InpDefaultSlPoints);
   if(!RiskPrecheckMarket(is_buy, sl, err)) { Comment("XauDesk: ", err); return; }
   if(ExecMarket(InpMagic, is_buy, g_lots, sl, 0, err)) Comment("XauDesk: ok");
   else Comment("XauDesk: ", err);
}

void FireClose()
{
   string err = "";
   if(!RiskPrecheckClose(err)) { Comment("XauDesk: ", err); return; }
   ulong t = CloseLatestAppTicket();
   if(t == 0) { Comment("XauDesk: no position"); return; }
   double cp = 0;
   if(ExecClose(InpMagic, t, err, cp)) Comment("XauDesk: closed");
   else Comment("XauDesk: ", err);
}

void ConsumeCtrlSlow()
{
   if(!FileIsExist("xau_ctrl.json", FILE_COMMON)) return;
   int h = FileOpen("xau_ctrl.json", FILE_READ|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   string s = "";
   while(!FileIsEnding(h)) s += FileReadString(h);
   FileClose(h);
   if(StringFind(s, "\"arm\":true") >= 0) RiskSetArmed(true);
   if(StringFind(s, "\"arm\":false") >= 0) RiskSetArmed(false);
}

int OnInit()
{
   string sym = (StringLen(InpSymbol) > 0) ? InpSymbol : _Symbol;
   if(!TradeExecInit(sym)) return INIT_FAILED;
   RiskSetRequireSl(InpRequireSL);
   RiskSetAllowDemo(InpAllowDemo);
   g_lots = InpLots1;
   if(!FastLaneBind(InpFastPort))
      Print("FastLane bind failed port=", InpFastPort);
   ChartSetInteger(0, CHART_KEYBOARD_CONTROL, true);
   if(!EventSetMillisecondTimer(InpTimerMs))
      return INIT_FAILED;
   StateWriteBin(InpMagic);
   Print("XauDeskExec sym=", g_sym, " fast=", InpFastPort, " FILE_COMMON ok");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   FastLaneShutdown();
}

void OnTimer()
{
   FastLanePoll(InpMagic, InpDefaultSlPoints);
   ulong now = GetTickCount64();
   if(now - g_last_state_ms >= (ulong)InpStateEveryMs)
   {
      ConsumeCtrlSlow();
      StateWriteBin(InpMagic);
      g_last_state_ms = now;
   }
}

void OnTick() { TradeExecOnTick(); }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_KEYDOWN) return;
   int k = (int)lparam;
   if(k == 32)
   {
      if(!RiskIsHalted()) { RiskSetArmed(!RiskIsArmed()); Comment(RiskIsArmed() ? "ARM" : "DISARM"); }
      return;
   }
   if(k == 49) { g_lots = InpLots1; return; }
   if(k == 50) { g_lots = InpLots2; return; }
   if(k == 51) { g_lots = InpLots3; return; }
   if(!RiskIsArmed()) return;
   if(k == 66) FireMarket(true);
   if(k == 83) FireMarket(false);
   if(k == 88) FireClose();
}
