//+------------------------------------------------------------------+
//| TradeExec.mqh · 缓存品种 + OrderSend 热路径                       |
//+------------------------------------------------------------------+
#ifndef __XAU_TRADE_EXEC_MQH__
#define __XAU_TRADE_EXEC_MQH__

struct TickCache
{
   double bid;
   double ask;
   long   time;
   bool   ok;
};

struct SymbolCache
{
   double vol_min;
   double vol_max;
   double vol_step;
   double point;
   int    digits;
   int    filling;
   int    deviation;
};

static TickCache   g_tick   = {0,0,0,false};
static SymbolCache g_symc   = {0,0,0,0,0,0,0};
static string      g_sym    = "";

bool TradeExecInit(const string symbol)
{
   g_sym = symbol;
   if(!SymbolSelect(g_sym, true)) return false;
   g_symc.vol_min  = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN);
   g_symc.vol_max  = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MAX);
   g_symc.vol_step = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_STEP);
   g_symc.point    = SymbolInfoDouble(g_sym, SYMBOL_POINT);
   g_symc.digits   = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   int fm = (int)SymbolInfoInteger(g_sym, SYMBOL_FILLING_MODE);
   if((fm & 2) == 2) g_symc.filling = ORDER_FILLING_IOC;
   else if((fm & 1) == 1) g_symc.filling = ORDER_FILLING_FOK;
   else g_symc.filling = ORDER_FILLING_RETURN;
   int spread = (int)SymbolInfoInteger(g_sym, SYMBOL_SPREAD);
   if(spread < 1) spread = 1;
   g_symc.deviation = (int)MathMin(MathMax(spread + 5, 10), 80);
   return true;
}

void TradeExecOnTick()
{
   MqlTick t;
   if(SymbolInfoTick(g_sym, t))
   {
      g_tick.bid = t.bid;
      g_tick.ask = t.ask;
      g_tick.time = t.time;
      g_tick.ok = true;
   }
}

bool NormalizeVol(double vol, double &out)
{
   if(g_symc.vol_step <= 0) g_symc.vol_step = 0.01;
   vol = MathMax(g_symc.vol_min, MathMin(g_symc.vol_max, vol));
   vol = MathFloor(vol / g_symc.vol_step) * g_symc.vol_step;
   out = NormalizeDouble(vol, 2);
   return vol >= g_symc.vol_min;
}

bool ExecMarketEx(const int magic, const bool is_buy, double lots, double sl, double tp, string &err, ulong &out_ticket)
{
   out_ticket = 0;
   if(!g_tick.ok) { err = "no tick"; return false; }
   double vol;
   if(!NormalizeVol(lots, vol)) { err = "volume"; return false; }

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = g_sym;
   req.magic     = magic;
   req.volume    = vol;
   req.deviation = g_symc.deviation;
   req.type_filling = (ENUM_ORDER_TYPE_FILLING)g_symc.filling;
   req.comment   = "xau_desk";

   if(is_buy) { req.type = ORDER_TYPE_BUY; req.price = g_tick.ask; }
   else       { req.type = ORDER_TYPE_SELL; req.price = g_tick.bid; }
   if(sl > 0) req.sl = NormalizeDouble(sl, g_symc.digits);
   if(tp > 0) req.tp = NormalizeDouble(tp, g_symc.digits);

   if(!OrderSend(req, res) || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
   {
      err = StringFormat("OrderSend %u", res.retcode);
      return false;
   }
   out_ticket = res.order;
   if(res.deal > 0 && HistoryDealSelect(res.deal))
   {
      ulong pos = (ulong)HistoryDealGetInteger(res.deal, DEAL_POSITION_ID);
      if(pos > 0)
         out_ticket = pos;
   }
   return true;
}

bool ExecMarket(const int magic, const bool is_buy, double lots, double sl, double tp, string &err)
{
   ulong ticket = 0;
   return ExecMarketEx(magic, is_buy, lots, sl, tp, err, ticket);
}

bool ExecClose(const int magic, const ulong ticket, string &err, double &profit_out)
{
   profit_out = 0;
   if(!PositionSelectByTicket(ticket)) { err = "no pos"; return false; }
   if((int)PositionGetInteger(POSITION_MAGIC) != magic) { err = "magic"; return false; }
   profit_out = PositionGetDouble(POSITION_PROFIT);

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action    = TRADE_ACTION_DEAL;
   req.position  = ticket;
   req.symbol    = PositionGetString(POSITION_SYMBOL);
   req.volume    = PositionGetDouble(POSITION_VOLUME);
   req.deviation = g_symc.deviation;
   req.magic     = magic;
   req.type_filling = (ENUM_ORDER_TYPE_FILLING)g_symc.filling;

   long typ = PositionGetInteger(POSITION_TYPE);
   if(!g_tick.ok)
   {
      MqlTick tk;
      if(SymbolInfoTick(req.symbol, tk))
      {
         g_tick.bid = tk.bid;
         g_tick.ask = tk.ask;
         g_tick.time = tk.time;
         g_tick.ok = true;
      }
   }
   if(typ == POSITION_TYPE_BUY) { req.type = ORDER_TYPE_SELL; req.price = g_tick.bid; }
   else { req.type = ORDER_TYPE_BUY; req.price = g_tick.ask; }

   if(!OrderSend(req, res)) { err = StringFormat("close %u", res.retcode); return false; }
   if(res.retcode == TRADE_RETCODE_DONE && res.deal > 0 && HistoryDealSelect(res.deal))
      profit_out = HistoryDealGetDouble(res.deal, DEAL_PROFIT);
   return res.retcode == TRADE_RETCODE_DONE;
}

bool ExecPending(const int magic, const bool is_buy, const string mode, double lots, double price, double stoplimit, double sl, double tp, string &err, ulong &out_ticket)
{
   out_ticket = 0;
   double vol;
   if(!NormalizeVol(lots, vol)) { err = "volume"; return false; }
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action = TRADE_ACTION_PENDING;
   req.symbol = g_sym;
   req.magic  = magic;
   req.volume = vol;
   req.deviation = g_symc.deviation;
   req.type_filling = (ENUM_ORDER_TYPE_FILLING)g_symc.filling;
   req.comment = "xau_desk";
   req.price = NormalizeDouble(price, g_symc.digits);
   if(mode == "stop")
      req.type = is_buy ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP;
   else if(mode == "stop_limit")
   {
      req.type = is_buy ? ORDER_TYPE_BUY_STOP_LIMIT : ORDER_TYPE_SELL_STOP_LIMIT;
      if(stoplimit <= 0) { err = "stop_limit 需要第二层限价"; return false; }
      req.stoplimit = NormalizeDouble(stoplimit, g_symc.digits);
   }
   else
      req.type = is_buy ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
   if(sl > 0) req.sl = NormalizeDouble(sl, g_symc.digits);
   if(tp > 0) req.tp = NormalizeDouble(tp, g_symc.digits);
   if(!OrderSend(req, res) || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
   {
      err = StringFormat("pending %u", res.retcode);
      return false;
   }
   out_ticket = res.order;
   return true;
}

bool ExecPendingLimit(const int magic, const bool is_buy, double lots, double price, double sl, double tp, string &err)
{
   ulong ticket = 0;
   return ExecPending(magic, is_buy, "limit", lots, price, 0, sl, tp, err, ticket);
}

bool ExecModifyOrder(const ulong ticket, double price, double sl, double tp, const bool set_sl, const bool set_tp, const bool set_price, string &err)
{
   if(!OrderSelect(ticket)) { err = "no order"; return false; }
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action = TRADE_ACTION_MODIFY;
   req.order  = ticket;
   req.symbol = OrderGetString(ORDER_SYMBOL);
   req.magic  = (int)OrderGetInteger(ORDER_MAGIC);
   req.type   = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
   req.volume = OrderGetDouble(ORDER_VOLUME_CURRENT);
   double px = set_price && price > 0 ? price : OrderGetDouble(ORDER_PRICE_OPEN);
   req.price = NormalizeDouble(px, g_symc.digits);
   double slv = set_sl ? sl : OrderGetDouble(ORDER_SL);
   double tpv = set_tp ? tp : OrderGetDouble(ORDER_TP);
   if(slv > 0) req.sl = NormalizeDouble(slv, g_symc.digits);
   if(tpv > 0) req.tp = NormalizeDouble(tpv, g_symc.digits);
   if(req.type == ORDER_TYPE_BUY_STOP_LIMIT || req.type == ORDER_TYPE_SELL_STOP_LIMIT)
      req.stoplimit = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
   if(!OrderSend(req, res))
   {
      err = StringFormat("modify order %u", res.retcode);
      return false;
   }
   return (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);
}

bool ExecModifySlTp(const int magic, const ulong ticket, double sl, double tp, string &err)
{
   if(!PositionSelectByTicket(ticket)) { err = "no pos"; return false; }
   if((int)PositionGetInteger(POSITION_MAGIC) != magic) { err = "magic"; return false; }
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action   = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.symbol   = PositionGetString(POSITION_SYMBOL);
   req.sl = (sl > 0) ? NormalizeDouble(sl, g_symc.digits) : PositionGetDouble(POSITION_SL);
   req.tp = (tp > 0) ? NormalizeDouble(tp, g_symc.digits) : PositionGetDouble(POSITION_TP);
   if(!OrderSend(req, res)) { err = StringFormat("modify %u", res.retcode); return false; }
   return true;
}

double DefaultSlPrice(const bool is_buy, const double sl_points)
{
   if(sl_points <= 0 || g_symc.point <= 0) return 0;
   double dist = sl_points * g_symc.point;
   if(is_buy) return NormalizeDouble(g_tick.ask - dist, g_symc.digits);
   return NormalizeDouble(g_tick.bid + dist, g_symc.digits);
}

#endif
