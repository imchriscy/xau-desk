//+------------------------------------------------------------------+
//| XauDeskBridge.mq5 · 写 xau_state.json（打通 XauDesk 连接）       |
//+------------------------------------------------------------------+
#property copyright "XauDesk"
#property version   "1.020"

#include <BridgeRpc.mqh>

input int    InpRefreshMs   = 16;
input bool   InpLatencyLog  = false;

long   g_last_login = 0;
string g_last_server = "";
string g_gold = "";
string g_last_instrument = "";
int    g_slow_tick = 0;
uint   g_block_bars_until = 0;

#define ACTIVE_INSTRUMENT_FILE "xau_active_instrument.txt"
#define SYMBOL_MAP_FILE        "xau_symbol_map.json"

string NormSymKey(const string sym)
{
   string u = sym;
   StringToUpper(u);
   StringReplace(u, ".", "");
   StringReplace(u, "/", "");
   StringReplace(u, "#", "");
   StringReplace(u, "-", "");
   StringReplace(u, " ", "");
   return u;
}

bool SymbolTradable(const string sym)
{
   if(!SymbolSelect(sym, true)) return false;
   long mode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   if(mode == SYMBOL_TRADE_MODE_DISABLED) return false;
   return true;
}

int ScoreInstrumentSymbol(const string sym, const string instId)
{
   string u = NormSymKey(sym);
   if(StringLen(u) < 3) return 0;
   int sc = 0;
   if(instId == "btc")
   {
      if(StringFind(u, "BTCUSD") == 0) sc = 100;
      else if(StringFind(u, "BTCUSD") >= 0) sc = 95;
      else if(StringFind(u, "BTC") >= 0 && StringFind(u, "USD") >= 0) sc = 85;
      else if(StringFind(u, "BITCOIN") >= 0) sc = 80;
      else if(StringFind(u, "BTC") >= 0) sc = 65;
      else return 0;
      if(StringFind(u, "XAU") >= 0 || StringFind(u, "GOLD") >= 0) return 0;
   }
   else if(instId == "nas100" || instId == "nas")
   {
      if(StringFind(u, "NAS100") >= 0) sc = 100;
      else if(StringFind(u, "US100") >= 0) sc = 95;
      else if(StringFind(u, "USTEC") >= 0) sc = 95;
      else if(StringFind(u, "NASDAQ") >= 0) sc = 85;
      else if(StringFind(u, "NDX") >= 0) sc = 80;
      else if(StringFind(u, "NAS") >= 0) sc = 75;
      else return 0;
      if(StringFind(u, "XAU") >= 0 || StringFind(u, "BTC") >= 0) return 0;
   }
   else
   {
      if(StringFind(u, "XAUUSD") == 0) sc = 100;
      else if(StringFind(u, "XAUUSD") >= 0) sc = 95;
      else if(StringFind(u, "GOLD") >= 0) sc = 75;
      else if(StringFind(u, "XAU") >= 0) sc = 70;
      else return 0;
      if(StringFind(u, "BTC") >= 0) return 0;
   }
   MqlTick t;
   if(SymbolInfoTick(sym, t) && t.bid > 0)
      sc += 15;
   return sc;
}

string DiscoverBestSymbol(const string instId)
{
   string best = "";
   int bestSc = 0;
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, false);
      int sc = ScoreInstrumentSymbol(s, instId);
      if(sc <= 0 || sc < bestSc) continue;
      if(!SymbolTradable(s)) continue;
      if(sc > bestSc)
      {
         bestSc = sc;
         best = s;
      }
      else if(sc == bestSc && StringLen(best) > 0 && StringLen(s) < StringLen(best))
         best = s;
   }
   if(StringLen(best) > 0)
      return best;
   total = SymbolsTotal(true);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, true);
      int sc = ScoreInstrumentSymbol(s, instId);
      if(sc > bestSc && SymbolTradable(s))
      {
         bestSc = sc;
         best = s;
      }
   }
   return best;
}

void WriteSymbolMap()
{
   string xau = DiscoverBestSymbol("xau");
   string btc = DiscoverBestSymbol("btc");
   string nas = DiscoverBestSymbol("nas100");
   string json = StringFormat(
      "{\"xau\":\"%s\",\"btc\":\"%s\",\"nas100\":\"%s\",\"active\":\"%s\",\"ts\":%.0f}",
      BridgeJsonEscape(xau),
      BridgeJsonEscape(btc),
      BridgeJsonEscape(nas),
      BridgeJsonEscape(ReadActiveInstrumentId()),
      (double)TimeGMT());
   WriteTextCommon(SYMBOL_MAP_FILE, json);
}

bool NameLooksLikeGold(const string sym)
{
   string u = sym;
   StringToUpper(u);
   if(StringFind(u, "XAU") >= 0) return true;
   if(StringFind(u, "GOLD") >= 0) return true;
   return false;
}

string DiscoverGoldSymbol()
{
   string prefs[6];
   prefs[0] = "XAUUSD";
   prefs[1] = "XAUUSDm";
   prefs[2] = "XAUUSDx";
   prefs[3] = "GOLD";
   prefs[4] = "XAUUSD.m";
   prefs[5] = "XAUUSDmicro";
   for(int i = 0; i < 6; i++)
   {
      if(SymbolSelect(prefs[i], true))
         return prefs[i];
   }
   int n = SymbolsTotal(false);
   for(int i = 0; i < n; i++)
   {
      string s = SymbolName(i, false);
      if(NameLooksLikeGold(s) && SymbolSelect(s, true))
         return s;
   }
   if(NameLooksLikeGold(_Symbol))
      return _Symbol;
   return _Symbol;
}

bool NameLooksLikeBtc(const string sym)
{
   string u = sym;
   StringToUpper(u);
   if(StringFind(u, "BTC") >= 0) return true;
   if(StringFind(u, "BITCOIN") >= 0) return true;
   return false;
}

bool NameLooksLikeNas(const string sym)
{
   string u = sym;
   StringToUpper(u);
   if(StringFind(u, "NAS") >= 0) return true;
   if(StringFind(u, "US100") >= 0) return true;
   if(StringFind(u, "USTEC") >= 0) return true;
   if(StringFind(u, "NDX") >= 0) return true;
   return false;
}

string ReadActiveInstrumentId()
{
   if(!FileIsExist(ACTIVE_INSTRUMENT_FILE, FILE_COMMON))
      return "xau";
   int h = FileOpen(ACTIVE_INSTRUMENT_FILE, FILE_READ|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h == INVALID_HANDLE) return "xau";
   string s = "";
   while(!FileIsEnding(h))
      s += FileReadString(h);
   FileClose(h);
   StringTrimLeft(s);
   StringTrimRight(s);
   StringToLower(s);
   if(StringLen(s) == 0) return "xau";
   return s;
}

bool TrySelectSymbol(const string sym)
{
   if(StringLen(sym) < 2) return false;
   return SymbolSelect(sym, true);
}

string DiscoverBtcSymbol()
{
   string c[6];
   c[0]="BTCUSD"; c[1]="BTCUSDm"; c[2]="BTCUSD."; c[3]="BTCUSDT"; c[4]="Bitcoin"; c[5]="BTC/USD";
   for(int i = 0; i < 6; i++)
      if(TrySelectSymbol(c[i])) return c[i];
   int mw = SymbolsTotal(true);
   for(int i = 0; i < mw; i++)
   {
      string s = SymbolName(i, true);
      if(NameLooksLikeBtc(s) && TrySelectSymbol(s))
         return s;
   }
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, false);
      if(NameLooksLikeBtc(s) && TrySelectSymbol(s))
         return s;
   }
   return "";
}

string DiscoverNasSymbol()
{
   string c[7];
   c[0]="NAS100"; c[1]="NAS100m"; c[2]="US100"; c[3]="USTEC"; c[4]="NAS100.";
   c[5]="US100.cash"; c[6]="NASDAQ100";
   for(int i = 0; i < 7; i++)
      if(TrySelectSymbol(c[i])) return c[i];
   int mw = SymbolsTotal(true);
   for(int i = 0; i < mw; i++)
   {
      string s = SymbolName(i, true);
      if(NameLooksLikeNas(s) && TrySelectSymbol(s))
         return s;
   }
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, false);
      if(NameLooksLikeNas(s) && TrySelectSymbol(s))
         return s;
   }
   return "";
}

string ResolveActiveSymbol()
{
   string id = ReadActiveInstrumentId();
   if(id == "nas") id = "nas100";
   if(id == "gold") id = "xau";
   string s = DiscoverBestSymbol(id);
   if(StringLen(s) > 0) return s;
   if(TrySelectSymbol(id)) return id;
   if(id == "xau") return DiscoverGoldSymbol();
   Print("XauDeskBridge: 券商未找到 ", id, " 类品种（已扫描全市场）");
   return "";
}

bool ActiveInstrumentMismatch(const string id, const string sym)
{
   if(StringLen(sym) < 2) return true;
   if(id == "btc" && !NameLooksLikeBtc(sym)) return true;
   if((id == "nas100" || id == "nas") && !NameLooksLikeNas(sym)) return true;
   if((id == "xau" || id == "gold") && !NameLooksLikeGold(sym)) return true;
   return false;
}

void RefreshActiveSymbol()
{
   string id = ReadActiveInstrumentId();
   bool need = (id != g_last_instrument) || StringLen(g_gold) == 0 || ActiveInstrumentMismatch(id, g_gold);
   if(!need) return;
   g_last_instrument = id;
   string next = ResolveActiveSymbol();
   if(StringLen(next) > 0)
   {
      g_gold = next;
      SymbolSelect(g_gold, true);
   }
   else if(id == "xau" || id == "gold")
      g_gold = DiscoverGoldSymbol();
   WriteSymbolMap();
   Print("XauDeskBridge active instrument=", id, " symbol=", g_gold);
}

bool WriteTextCommon(const string name, const string body)
{
   if(BridgeWriteWholeFileCommon(name, body))
      return true;
   int h = FileOpen(name, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h == INVALID_HANDLE)
      h = FileOpen(name, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   FileWriteString(h, body);
   FileClose(h);
   return true;
}

string AccountKindLabel(const long mode)
{
   if(mode==ACCOUNT_TRADE_MODE_REAL) return "real";
   if(mode==ACCOUNT_TRADE_MODE_DEMO) return "demo";
   return "other";
}

string AccountKindLabelCn(const long mode)
{
   if(mode==ACCOUNT_TRADE_MODE_REAL) return "\\u5b9e\\u76d8";
   if(mode==ACCOUNT_TRADE_MODE_DEMO) return "\\u6f14\\u793a";
   return "\\u5176\\u4ed6";
}

void WriteState()
{
   if(StringLen(g_gold) == 0)
      g_gold = DiscoverGoldSymbol();
   if(!SymbolSelect(g_gold, true))
      Print("XauDeskBridge SymbolSelect failed sym=", g_gold, " err=", GetLastError());

   MqlTick t;
   bool tickOk = SymbolInfoTick(g_gold, t);
   double bid = tickOk ? t.bid : 0.0;
   double ask = tickOk ? t.ask : 0.0;
   double last = bid;
   long   tickTime = tickOk ? t.time : (long)TimeCurrent();

   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string srv = AccountInfoString(ACCOUNT_SERVER);
   string session = StringFormat("%I64d@%s", login, srv);

   string positions = "[";
   int pn = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string psym = PositionGetString(POSITION_SYMBOL);
      if(psym != g_gold) continue;
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
      double slp = PositionGetDouble(POSITION_SL);
      double tpp = PositionGetDouble(POSITION_TP);
      if(pn > 0) positions += ",";
      positions += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%.2f,\"open_price\":%.5f,\"sl\":%s,\"tp\":%s,\"profit\":%.2f,\"open_time\":%I64d}",
         ticket, BridgeJsonEscape(psym), side, PositionGetDouble(POSITION_VOLUME),
         PositionGetDouble(POSITION_PRICE_OPEN),
         (slp > 0 ? StringFormat("%.5f", slp) : "null"),
         (tpp > 0 ? StringFormat("%.5f", tpp) : "null"),
         PositionGetDouble(POSITION_PROFIT),
         (long)PositionGetInteger(POSITION_TIME)
      );
      pn++;
   }
   positions += "]";

   string orders = "[";
   int on = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ot = OrderGetTicket(i);
      if(ot == 0 || !OrderSelect(ot)) continue;
      if(OrderGetString(ORDER_SYMBOL) != g_gold) continue;
      ENUM_ORDER_TYPE typ = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      string oside = (typ==ORDER_TYPE_BUY_LIMIT || typ==ORDER_TYPE_BUY_STOP || typ==ORDER_TYPE_BUY_STOP_LIMIT) ? "buy" : "sell";
      string omode = "limit";
      if(typ==ORDER_TYPE_BUY_STOP || typ==ORDER_TYPE_SELL_STOP) omode = "stop";
      if(typ==ORDER_TYPE_BUY_STOP_LIMIT || typ==ORDER_TYPE_SELL_STOP_LIMIT) omode = "stop_limit";
      double osl = OrderGetDouble(ORDER_SL);
      double otp = OrderGetDouble(ORDER_TP);
      if(on > 0) orders += ",";
      orders += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"mode\":\"%s\",\"lots\":%.2f,\"price\":%.5f,\"sl\":%s,\"tp\":%s,\"setup_time\":%I64d}",
         ot, BridgeJsonEscape(g_gold), oside, omode,
         OrderGetDouble(ORDER_VOLUME_CURRENT),
         OrderGetDouble(ORDER_PRICE_OPEN),
         (osl > 0 ? StringFormat("%.5f", osl) : "null"),
         (otp > 0 ? StringFormat("%.5f", otp) : "null"),
         (long)OrderGetInteger(ORDER_TIME_SETUP)
      );
      on++;
   }
   orders += "]";

   string json = StringFormat(
      "{\"connected\":true,\"bridge_ver\":\"1.020\",\"ts\":%.0f,\"symbol\":\"%s\",\"active_instrument\":\"%s\","
      "\"bridge_session\":\"%s\","
      "\"quote\":{\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"last\":%.5f,\"time\":%I64d,\"mt5_ms\":0.1},"
      "\"account\":{\"login\":%I64d,\"server\":\"%s\",\"name\":\"%s\",\"currency\":\"%s\","
      "\"equity\":%.2f,\"balance\":%.2f,"
      "\"margin\":%.2f,\"margin_free\":%.2f,\"profit\":%.2f,\"leverage\":%d,"
      "\"account_kind\":\"%s\",\"account_kind_label\":\"%s\","
      "\"trade_allowed\":%s,\"trade_expert\":%s,\"terminal_trade_allowed\":%s},"
      "\"positions\":%s,\"orders\":%s,\"risk\":{\"require_stop_loss\":false,\"halted\":false}}"
      ,
      (double)TimeGMT(),
      BridgeJsonEscape(g_gold),
      BridgeJsonEscape(ReadActiveInstrumentId()),
      BridgeJsonEscape(session),
      BridgeJsonEscape(g_gold),
      bid, ask, last, tickTime,
      login,
      BridgeJsonEscape(srv),
      BridgeJsonEscape(AccountInfoString(ACCOUNT_NAME)),
      BridgeJsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoDouble(ACCOUNT_PROFIT),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      AccountKindLabel(mode),
      AccountKindLabelCn(mode),
      (MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false"),
      (MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false"),
      (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false"),
      positions,
      orders
   );
   if(!WriteTextCommon("xau_state.json", json))
      Print("XauDeskBridge write failed err=", GetLastError());
   WriteStateBinFast(login, bid, ask);
}

struct DoublePack { double val; };

void PutDoubleLE(uchar &buf[], const int off, const double v)
{
   DoublePack d;
   d.val = v;
   uchar raw[8];
   ArrayInitialize(raw, 0);
   int n = StructToCharArray(d, raw, 0);
   int lim = (n < 8) ? n : 8;
   for(int i = 0; i < lim; i++)
      buf[off + i] = raw[i];
}

void WriteStateBinFast(const long login, const double bid, const double ask)
{
   uchar buf[128];
   ArrayInitialize(buf, 0);
   StringToCharArray("XAU1", buf, 0, 4);
   buf[4] = 1;
   PutDoubleLE(buf, 8, (double)TimeGMT());
   StringToCharArray(g_gold, buf, 16, 16);
   PutDoubleLE(buf, 32, bid);
   PutDoubleLE(buf, 40, ask);
   for(int i = 0; i < 8; i++)
      buf[52 + i] = (uchar)((login >> (8 * i)) & 0xFF);
   PutDoubleLE(buf, 60, AccountInfoDouble(ACCOUNT_EQUITY));
   PutDoubleLE(buf, 68, AccountInfoDouble(ACCOUNT_BALANCE));
   int h = FileOpen("xau_state.bin", FILE_WRITE | FILE_BIN | FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   FileWriteArray(h, buf, 0, 128);
   FileClose(h);
}

void WriteQuoteFast()
{
   if(StringLen(g_gold) == 0) g_gold = DiscoverGoldSymbol();
   MqlTick t;
   if(!SymbolInfoTick(g_gold, t)) return;
   string line = StringFormat("%.5f,%.5f,%s", t.bid, t.ask, g_gold);
   WriteTextCommon("xau_quote.txt", line);
}

void PumpOnce()
{
   RefreshActiveSymbol();
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string srv = AccountInfoString(ACCOUNT_SERVER);
   if(login != g_last_login || srv != g_last_server)
   {
      if(g_last_login > 0)
         Print("XauDeskBridge session switch ",
               g_last_login, "@", g_last_server, " -> ", login, "@", srv);
      g_last_login = login;
      g_last_server = srv;
      WriteState();
   }
   if(BridgeProcessTrade(g_gold))
   {
      g_block_bars_until = GetTickCount() + 600;
      WriteState();
   }
   WriteQuoteFast();
   g_slow_tick++;
   if((g_slow_tick % 256) == 0)
      WriteSymbolMap();
   if((g_slow_tick % 4) == 0)
      WriteState();
   bool barsBusy = (GetTickCount() < g_block_bars_until) || FileIsExist("xau_trade.json", FILE_COMMON);
   if(!barsBusy)
      BridgeProcessCommand(g_gold);
}

int OnInit()
{
   BridgeLatencySetEnabled(InpLatencyLog);
   RefreshActiveSymbol();
   if(StringLen(g_gold) == 0)
      g_gold = DiscoverGoldSymbol();
   g_last_login = AccountInfoInteger(ACCOUNT_LOGIN);
   g_last_server = AccountInfoString(ACCOUNT_SERVER);
   if(!EventSetMillisecondTimer(InpRefreshMs))
   {
      Print("EventSetMillisecondTimer failed, fallback 1s");
      EventSetTimer(1);
   }
   WriteSymbolMap();
   WriteState();
   Print("XauDeskBridge started login=", g_last_login, " srv=", g_last_server,
         " chart=", _Symbol, " gold=", g_gold);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTick() { BridgeProcessTrade(g_gold); }

void OnTimer() { PumpOnce(); }
