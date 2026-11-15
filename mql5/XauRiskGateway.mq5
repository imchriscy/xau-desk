//+------------------------------------------------------------------+
//| XauRiskGateway.mq5 · Mac/MT5 执行层（文件桥接 Phase 1）          |
//| 与 gateway-mac/server.mjs 通过 Common/Files/*.json 通信          |
//+------------------------------------------------------------------+
#property copyright "XauDesk"
#property version   "0.1.0"

input string InpSymbol        = "";           // 空=图表品种
input int    InpMagic         = 8805190;      // 与 Windows APP_MAGIC 一致
input int    InpTimerMs       = 100;
input bool   InpRequireSL     = true;
input bool   InpAllowDemo     = true;

#define STATE_FILE "xau_state.json"
#define CMD_FILE   "xau_cmd.json"
#define ACK_FILE   "xau_ack.json"

string g_symbol;
ulong  g_lastStateMs = 0;

//--- timeframe map
ENUM_TIMEFRAMES TfToEnum(const string tf)
{
   if(tf=="1m")  return PERIOD_M1;
   if(tf=="3m")  return PERIOD_M3;
   if(tf=="5m")  return PERIOD_M5;
   if(tf=="15m") return PERIOD_M15;
   if(tf=="30m") return PERIOD_M30;
   if(tf=="1h")  return PERIOD_H1;
   if(tf=="4h")  return PERIOD_H4;
   if(tf=="1d")  return PERIOD_D1;
   return PERIOD_CURRENT;
}

bool FileDeleteCommon(const string name)
{
   if(!FileIsExist(name, FILE_COMMON)) return true;
   return FileDelete(name, FILE_COMMON);
}

string ReadWholeFileCommon(const string name)
{
   if(!FileIsExist(name, FILE_COMMON)) return "";
   int h = FileOpen(name, FILE_READ|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h==INVALID_HANDLE) return "";
   string s="";
   while(!FileIsEnding(h))
      s += FileReadString(h);
   FileClose(h);
   return s;
}

bool WriteWholeFileCommon(const string name, const string body)
{
   int h = FileOpen(name, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h==INVALID_HANDLE) return false;
   FileWriteString(h, body);
   FileClose(h);
   return true;
}

string JsonEscape(const string s)
{
   string o="";
   int n=(int)StringLen(s);
   for(int i=0;i<n;i++)
   {
      ushort c=StringGetCharacter(s,i);
      if(c=='\\') o+="\\\\";
      else if(c=='"') o+="\\\"";
      else if(c=='\n') o+="\\n";
      else o+=ShortToString(c);
   }
   return o;
}

string ExtractJsonString(const string json, const string key)
{
   string pat = "\""+key+"\":\"";
   int p = StringFind(json, pat);
   if(p<0)
   {
      pat = "\""+key+"\": \"";
      p = StringFind(json, pat);
   }
   if(p<0) return "";
   p += (int)StringLen(pat);
   int e = StringFind(json, "\"", p);
   if(e<0) return "";
   return StringSubstr(json, p, e-p);
}

double ExtractJsonNumber(const string json, const string key)
{
   string pat = "\""+key+"\":";
   int p = StringFind(json, pat);
   if(p<0) return 0;
   p += (int)StringLen(pat);
   string tail = StringSubstr(json, p);
   StringTrimLeft(tail);
   int e=0;
   for(e=0; e<(int)StringLen(tail); e++)
   {
      ushort c=StringGetCharacter(tail,e);
      if((c>='0' && c<='9') || c=='.' || c=='-' || c=='e' || c=='E' || c=='+') continue;
      break;
   }
   return StringToDouble(StringSubstr(tail,0,e));
}

bool ExtractJsonBool(const string json, const string key, const bool def)
{
   string pat = "\""+key+"\":";
   int p = StringFind(json, pat);
   if(p<0) return def;
   p += (int)StringLen(pat);
   string tail = StringSubstr(json, p, 6);
   if(StringFind(tail, "true")>=0) return true;
   if(StringFind(tail, "false")>=0) return false;
   return def;
}

string AccountKindLabel(const long mode)
{
   if(mode==ACCOUNT_TRADE_MODE_REAL) return "实盘";
   if(mode==ACCOUNT_TRADE_MODE_DEMO) return "演示";
   return "其他";
}

string AccountKind(const long mode)
{
   if(mode==ACCOUNT_TRADE_MODE_REAL) return "real";
   return "demo";
}

string BuildAccountJson()
{
   string name = AccountInfoString(ACCOUNT_NAME);
   string company = AccountInfoString(ACCOUNT_COMPANY);
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   return StringFormat(
      "\"login\":%I64d,\"server\":\"%s\",\"name\":\"%s\",\"company\":\"%s\","
      "\"currency\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,"
      "\"margin_free\":%.2f,\"profit\":%.2f,\"leverage\":%d,"
      "\"account_kind\":\"%s\",\"account_kind_label\":\"%s\","
      "\"trade_allowed\":%s,\"trade_expert\":%s,\"terminal_trade_allowed\":%s",
      AccountInfoInteger(ACCOUNT_LOGIN),
      JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(name),
      JsonEscape(company),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoDouble(ACCOUNT_PROFIT),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      AccountKind(mode),
      JsonEscape(AccountKindLabel(mode)),
      (MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false"),
      (MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false"),
      (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false")
   );
}

void BuildPositionsJson(string &out)
{
   out = "[";
   int n=0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket==0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(sym!=g_symbol && StringLen(InpSymbol)>0) continue;
      if((int)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      string side = (PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY) ? "buy" : "sell";
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      string sls = (sl>0) ? StringFormat("%.5f", sl) : "null";
      string tps = (tp>0) ? StringFormat("%.5f", tp) : "null";
      if(n>0) out += ",";
      out += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%.2f,"
         "\"open_price\":%.5f,\"sl\":%s,\"tp\":%s,\"profit\":%.2f,\"open_time\":%I64d,\"magic\":%d}",
         ticket, JsonEscape(sym), side, PositionGetDouble(POSITION_VOLUME),
         PositionGetDouble(POSITION_PRICE_OPEN), sls, tps,
         PositionGetDouble(POSITION_PROFIT),
         PositionGetInteger(POSITION_TIME), InpMagic
      );
      n++;
   }
   out += "]";
}

void BuildOrdersJson(string &out)
{
   out = "[";
   int n=0;
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket==0) continue;
      if(!OrderSelect(ticket)) continue;
      if(OrderGetString(ORDER_SYMBOL)!=g_symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)!=InpMagic) continue;
      ENUM_ORDER_TYPE t = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      string side = (t==ORDER_TYPE_BUY_LIMIT || t==ORDER_TYPE_BUY_STOP || t==ORDER_TYPE_BUY_STOP_LIMIT) ? "buy" : "sell";
      string mode = "limit";
      if(t==ORDER_TYPE_BUY_STOP || t==ORDER_TYPE_SELL_STOP) mode="stop";
      double sl = OrderGetDouble(ORDER_SL);
      double tp = OrderGetDouble(ORDER_TP);
      string sls = (sl>0) ? StringFormat("%.5f", sl) : "null";
      string tps = (tp>0) ? StringFormat("%.5f", tp) : "null";
      if(n>0) out += ",";
      out += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"mode\":\"%s\",\"lots\":%.2f,"
         "\"price\":%.5f,\"sl\":%s,\"tp\":%s,\"setup_time\":%I64d,\"magic\":%d}",
         ticket, JsonEscape(g_symbol), side, mode, OrderGetDouble(ORDER_VOLUME_CURRENT),
         OrderGetDouble(ORDER_PRICE_OPEN), sls, tps,
         OrderGetInteger(ORDER_TIME_SETUP), InpMagic
      );
      n++;
   }
   out += "]";
}

void WriteState()
{
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol, tick)) return;
   ulong t0=GetMicrosecondCount();
   SymbolInfoTick(g_symbol, tick);
   double mt5_ms = (GetMicrosecondCount()-t0)/1000.0;

   string positions, orders;
   BuildPositionsJson(positions);
   BuildOrdersJson(orders);

   int app_slots = 0;
   // rough count from positions json commas — recount properly
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)==g_symbol && (int)PositionGetInteger(POSITION_MAGIC)==InpMagic)
         app_slots++;
   }

   string body = StringFormat(
      "{\"connected\":true,\"ts\":%.3f,\"symbol\":\"%s\",\"terminal\":\"%s\","
      "\"trade_allowed\":%s,"
      "\"quote\":{\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"last\":%.5f,\"time\":%I64d,\"mt5_ms\":%.2f},"
      "\"account\":{%s},"
      "\"positions\":%s,"
      "\"orders\":%s,"
      "\"risk\":{\"require_stop_loss\":%s,\"halted\":false,\"halt_reason\":null,"
      "\"consecutive_losses\":0,\"app_open_slots\":%d}}"
      ,
      (double)TimeCurrent(),
      JsonEscape(g_symbol),
      JsonEscape(TerminalInfoString(TERMINAL_NAME)),
      (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true":"false"),
      JsonEscape(g_symbol), tick.bid, tick.ask, (tick.bid+tick.ask)/2.0, tick.time, mt5_ms,
      BuildAccountJson(),
      positions,
      orders,
      (InpRequireSL ? "true":"false"),
      app_slots
   );
   WriteWholeFileCommon(STATE_FILE, body);
   g_lastStateMs = GetTickCount64();
}

bool NormalizeVolume(double vol, double &out)
{
   double vmin = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
   if(vstep<=0) vstep=0.01;
   vol = MathMax(vmin, MathMin(vmax, vol));
   vol = MathFloor(vol/vstep)*vstep;
   out = NormalizeDouble(vol, 2);
   return (vol>=vmin);
}

bool SendMarket(const string side, double lots, double sl, double tp, const bool allow_demo, string &err)
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode!=ACCOUNT_TRADE_MODE_REAL && !(InpAllowDemo || allow_demo))
   {
      err = "演示账户未允许；EA 输入 InpAllowDemo=true 或切换实盘";
      return false;
   }
   if(InpRequireSL && sl<=0)
   {
      err = "risk_reject: require_stop_loss";
      return false;
   }
   double vol;
   if(!NormalizeVolume(lots, vol)) { err="invalid volume"; return false; }

   MqlTradeRequest req={};
   MqlTradeResult  res={};
   req.action   = TRADE_ACTION_DEAL;
   req.symbol   = g_symbol;
   req.magic    = InpMagic;
   req.volume   = vol;
   req.deviation= 30;
   req.comment  = "xau_desk";

   MqlTick tick;
   SymbolInfoTick(g_symbol, tick);
   if(side=="buy")
   {
      req.type  = ORDER_TYPE_BUY;
      req.price = tick.ask;
   }
   else
   {
      req.type  = ORDER_TYPE_SELL;
      req.price = tick.bid;
   }
   if(sl>0) req.sl=sl;
   if(tp>0) req.tp=tp;

   if(!OrderSend(req, res))
   {
      err = StringFormat("OrderSend %d: %s", res.retcode, res.comment);
      return false;
   }
   return (res.retcode==TRADE_RETCODE_DONE || res.retcode==TRADE_RETCODE_PLACED);
}

bool CloseTicket(const ulong ticket, string &err)
{
   if(!PositionSelectByTicket(ticket))
   {
      err="position not found";
      return false;
   }
   if((int)PositionGetInteger(POSITION_MAGIC)!=InpMagic)
   {
      err="not app magic";
      return false;
   }
   MqlTradeRequest req={};
   MqlTradeResult  res={};
   req.action   = TRADE_ACTION_DEAL;
   req.position = ticket;
   req.symbol   = PositionGetString(POSITION_SYMBOL);
   req.volume   = PositionGetDouble(POSITION_VOLUME);
   req.deviation= 30;
   req.magic    = InpMagic;
   long typ = PositionGetInteger(POSITION_TYPE);
   MqlTick tick;
   SymbolInfoTick(req.symbol, tick);
   if(typ==POSITION_TYPE_BUY)
   {
      req.type  = ORDER_TYPE_SELL;
      req.price = tick.bid;
   }
   else
   {
      req.type  = ORDER_TYPE_BUY;
      req.price = tick.ask;
   }
   if(!OrderSend(req, res))
   {
      err = StringFormat("close %d", res.retcode);
      return false;
   }
   return res.retcode==TRADE_RETCODE_DONE;
}

bool ModifyPosition(const ulong ticket, double sl, double tp, string &err)
{
   if(!PositionSelectByTicket(ticket)) { err="no position"; return false; }
   if((int)PositionGetInteger(POSITION_MAGIC)!=InpMagic) { err="magic"; return false; }
   MqlTradeRequest req={};
   MqlTradeResult  res={};
   req.action   = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.symbol   = PositionGetString(POSITION_SYMBOL);
   req.sl = (sl>0)?sl:PositionGetDouble(POSITION_SL);
   req.tp = (tp>0)?tp:PositionGetDouble(POSITION_TP);
   if(!OrderSend(req, res))
   {
      err = StringFormat("modify %d", res.retcode);
      return false;
   }
   return true;
}

string BuildBarsJson(const string tf, int count)
{
   ENUM_TIMEFRAMES p = TfToEnum(tf);
   if(p==PERIOD_CURRENT) return "";
   MqlRates rates[];
   ulong t0=GetMicrosecondCount();
   int got = CopyRates(g_symbol, p, 0, count, rates);
   double mt5_ms = (GetMicrosecondCount()-t0)/1000.0;
   if(got<=0) return "";
   int n = ArraySize(rates);
   if(n > got) n = got;

   string candles="[";
   for(int i=0;i<n;i++)
   {
      if(i>0) candles+=",";
      candles += StringFormat(
         "{\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%.0f}",
         rates[i].time, rates[i].open, rates[i].high, rates[i].low, rates[i].close, rates[i].tick_volume
      );
   }
   candles += "]";
   return StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"count\":%d,\"candles\":%s,\"mt5_ms\":%.2f}",
      JsonEscape(g_symbol), tf, n, candles, mt5_ms
   );
}

void WriteAck(const string id, const bool ok, const string payload, const string err)
{
   string body;
   if(ok)
      body = StringFormat("{\"id\":\"%s\",\"ok\":true,\"result\":%s}", id, payload);
   else
      body = StringFormat("{\"id\":\"%s\",\"ok\":false,\"error\":\"%s\"}", id, JsonEscape(err));
   WriteWholeFileCommon(ACK_FILE, body);
}

void ProcessCommand()
{
   string cmd = ReadWholeFileCommon(CMD_FILE);
   if(StringLen(cmd)<3) return;
   FileDeleteCommon(CMD_FILE);

   string id = ExtractJsonString(cmd, "id");
   string op = ExtractJsonString(cmd, "op");
   if(StringLen(id)==0 || StringLen(op)==0) return;

   string err="";
   if(op=="market")
   {
      string side = ExtractJsonString(cmd, "side");
      double lots = ExtractJsonNumber(cmd, "lots");
      double sl   = ExtractJsonNumber(cmd, "sl");
      double tp   = ExtractJsonNumber(cmd, "tp");
      bool allow_demo = ExtractJsonBool(cmd, "allow_demo_mt5", false);
      bool ok = SendMarket(side, lots, sl, tp, allow_demo, err);
      if(ok)
         WriteAck(id, true, "{\"ok\":true}", "");
      else
         WriteAck(id, false, "{}", err);
      return;
   }
   if(op=="close")
   {
      ulong ticket = (ulong)ExtractJsonNumber(cmd, "ticket");
      bool ok = CloseTicket(ticket, err);
      WriteAck(id, ok, "{\"ok\":true}", err);
      return;
   }
   if(op=="position_modify")
   {
      ulong ticket = (ulong)ExtractJsonNumber(cmd, "ticket");
      double sl = ExtractJsonNumber(cmd, "sl");
      double tp = ExtractJsonNumber(cmd, "tp");
      bool ok = ModifyPosition(ticket, sl, tp, err);
      WriteAck(id, ok, "{\"ok\":true}", err);
      return;
   }
   if(op=="bars")
   {
      string tf = ExtractJsonString(cmd, "timeframe");
      int count = (int)ExtractJsonNumber(cmd, "count");
      if(count<=0) count=500;
      string bars = BuildBarsJson(tf, count);
      if(StringLen(bars)==0)
         WriteAck(id, false, "{}", "copy_rates failed");
      else
         WriteAck(id, true, bars, "");
      return;
   }

   WriteAck(id, false, "{}", "unknown op");
}

int OnInit()
{
   g_symbol = (StringLen(InpSymbol)>0) ? InpSymbol : _Symbol;
   if(!SymbolSelect(g_symbol, true))
   {
      Print("SymbolSelect failed: ", g_symbol);
      return INIT_FAILED;
   }
   if(!EventSetMillisecondTimer(InpTimerMs))
   {
      Print("EventSetMillisecondTimer failed");
      return INIT_FAILED;
   }
   WriteState();
   Print("XauRiskGateway on ", g_symbol, " magic=", InpMagic);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   ProcessCommand();
   WriteState();
}

void OnTick()
{
   if(GetTickCount64()-g_lastStateMs > (ulong)InpTimerMs*3)
      WriteState();
}
