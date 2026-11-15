//+------------------------------------------------------------------+
//| BridgeRpc.mqh · 文件桥 K 线等慢路径 RPC（供 XauDeskBridge）      |
//+------------------------------------------------------------------+
#ifndef XAUDESK_BRIDGE_RPC_MQH
#define XAUDESK_BRIDGE_RPC_MQH

#include <TradeExec.mqh>

#define BRIDGE_CMD_FILE  "xau_cmd.json"
#define BRIDGE_ACK_FILE  "xau_ack.json"
#define BRIDGE_TRADE_FILE "xau_trade.json"
#define BRIDGE_TRADE_ACK  "xau_trade_ack.json"
#define LATENCY_LOG_FILE  "xau_latency.jsonl"
#define BRIDGE_MAGIC 8805190

ulong g_latency_ea_us0 = 0;
string g_latency_trace_id = "";
bool  g_bridge_latency_log = false;

void BridgeLatencySetEnabled(const bool on) { g_bridge_latency_log = on; }

void BridgeLatencyAppend(const string stage, const string op, const ulong ea_us,
                         const long gw_t_cmd_write_ms, const ulong ea_local_ms)
{
   if(!g_bridge_latency_log) return;
   string tid = g_latency_trace_id;
   if(StringLen(tid) == 0) tid = "-";
   string line = StringFormat(
      "{\"trace_id\":\"%s\",\"stage\":\"%s\",\"op\":\"%s\",\"ea_us\":%I64u,"
      "\"gw_t_cmd_write_ms\":%I64d,\"ea_local_ms\":%I64u}",
      BridgeJsonEscape(tid), BridgeJsonEscape(stage), BridgeJsonEscape(op),
      ea_us, gw_t_cmd_write_ms, ea_local_ms);
   int h = FileOpen(LATENCY_LOG_FILE, FILE_READ|FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h == INVALID_HANDLE)
      h = FileOpen(LATENCY_LOG_FILE, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, line + "\n");
   FileClose(h);
}

ulong BridgeLocalMsNow()
{
   return (ulong)TimeLocal() * 1000 + (GetMicrosecondCount() / 1000) % 1000;
}

ENUM_TIMEFRAMES BridgeTfToEnum(const string tf)
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

bool BridgeFileDeleteCommon(const string name)
{
   if(!FileIsExist(name, FILE_COMMON)) return true;
   return FileDelete(name, FILE_COMMON);
}

string BridgeReadWholeFileCommon(const string name)
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

bool BridgeWriteWholeFileCommon(const string name, const string body)
{
   int h = FileOpen(name, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(h==INVALID_HANDLE) return false;
   FileWriteString(h, body);
   FileClose(h);
   return true;
}

string BridgeJsonEscape(const string s)
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

string BridgeExtractJsonString(const string json, const string key)
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

double BridgeExtractJsonNumber(const string json, const string key)
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

void BridgeWriteAckFile(const string file, const string id, const bool ok, const string payload, const string err)
{
   string body;
   if(ok)
      body = StringFormat("{\"id\":\"%s\",\"ok\":true,\"result\":%s}", id, payload);
   else
      body = StringFormat("{\"id\":\"%s\",\"ok\":false,\"error\":\"%s\"}", id, BridgeJsonEscape(err));
   BridgeWriteWholeFileCommon(file, body);
}

void BridgeWriteAck(const string id, const bool ok, const string payload, const string err)
{
   BridgeWriteAckFile(BRIDGE_ACK_FILE, id, ok, payload, err);
}

string BridgeBuildBarsJson(const string symbol, const string tf, int count)
{
   ENUM_TIMEFRAMES p = BridgeTfToEnum(tf);
   if(p==PERIOD_CURRENT) return "";
   MqlRates rates[];
   ulong t0=GetMicrosecondCount();
   int got = CopyRates(symbol, p, 0, count, rates);
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
      BridgeJsonEscape(symbol), tf, n, candles, mt5_ms
   );
}

bool BridgeExecTrade(const string cmd, const string op, const string symbol, string &result, string &err)
{
   if(!TradeExecInit(symbol))
   {
      err = "品种不可交易: " + symbol;
      return false;
   }
   TradeExecOnTick();
   double lots = BridgeExtractJsonNumber(cmd, "lots");
   if(lots <= 0) lots = 0.01;
   double sl = BridgeExtractJsonNumber(cmd, "sl");
   double tp = BridgeExtractJsonNumber(cmd, "tp");
   string side = BridgeExtractJsonString(cmd, "side");
   bool buy = (side != "sell");

   if(op == "market")
   {
      ulong t0 = GetMicrosecondCount();
      BridgeLatencyAppend("ea_ordersend_before", op, t0, 0, BridgeLocalMsNow());
      ulong ticket = 0;
      if(!ExecMarketEx(BRIDGE_MAGIC, buy, lots, sl, tp, err, ticket))
      {
         if(StringLen(err)==0) err = "市价单失败";
         return false;
      }
      ulong t1 = GetMicrosecondCount();
      BridgeLatencyAppend("ea_ordersend_after", op, t1, 0, BridgeLocalMsNow());
      double px = buy ? g_tick.ask : g_tick.bid;
      result = StringFormat(
         "{\"ok\":true,\"ticket\":%I64u,\"price\":%.5f,\"side\":\"%s\",\"lots\":%.2f,"
         "\"ordersend_us\":%I64u}",
         ticket, px, (buy ? "buy" : "sell"), lots, (t1 - t0));
      return true;
   }
   if(op == "close")
   {
      ulong ticket = (ulong)BridgeExtractJsonNumber(cmd, "ticket");
      ulong t0 = GetMicrosecondCount();
      BridgeLatencyAppend("ea_ordersend_before", op, t0, 0, BridgeLocalMsNow());
      double closeProfit = 0;
      string sym = BridgeExtractJsonString(cmd, "symbol");
      if(StringLen(sym) < 2) sym = symbol;
      if(!ExecClose(BRIDGE_MAGIC, ticket, err, closeProfit))
      {
         if(StringLen(err)==0) err = "平仓失败";
         return false;
      }
      ulong t1 = GetMicrosecondCount();
      BridgeLatencyAppend("ea_ordersend_after", op, t1, 0, BridgeLocalMsNow());
      result = StringFormat(
         "{\"ok\":true,\"profit\":%.2f,\"symbol\":\"%s\",\"position_ticket\":%I64u,\"ordersend_us\":%I64u}",
         closeProfit, BridgeJsonEscape(sym), ticket, (t1 - t0));
      return true;
   }
   if(op == "position_modify")
   {
      ulong ticket = (ulong)BridgeExtractJsonNumber(cmd, "ticket");
      if(!ExecModifySlTp(BRIDGE_MAGIC, ticket, sl, tp, err))
      {
         if(StringLen(err)==0) err = "修改止损止盈失败";
         return false;
      }
      result = "{\"ok\":true}";
      return true;
   }
   if(op == "order_modify")
   {
      ulong ticket = (ulong)BridgeExtractJsonNumber(cmd, "ticket");
      bool setSl = (StringFind(cmd, "\"sl\":") >= 0);
      bool setTp = (StringFind(cmd, "\"tp\":") >= 0);
      bool setPx = (StringFind(cmd, "\"price\":") >= 0);
      double price = BridgeExtractJsonNumber(cmd, "price");
      if(!TradeExecInit(symbol)) { err = "品种不可交易"; return false; }
      if(!ExecModifyOrder(ticket, price, sl, tp, setSl, setTp, setPx, err))
      {
         if(StringLen(err)==0) err = "改挂单失败";
         return false;
      }
      result = "{\"ok\":true}";
      return true;
   }
   if(op == "pending" || op == "limit")
   {
      double price = BridgeExtractJsonNumber(cmd, "price");
      double stoplimit = BridgeExtractJsonNumber(cmd, "stoplimit");
      string mode = BridgeExtractJsonString(cmd, "mode");
      if(StringLen(mode)==0) mode = (op == "limit") ? "limit" : "limit";
      ulong ticket = 0;
      if(!ExecPending(BRIDGE_MAGIC, buy, mode, lots, price, stoplimit, sl, tp, err, ticket))
      {
         if(StringLen(err)==0) err = "挂单失败";
         return false;
      }
      result = StringFormat("{\"ok\":true,\"ticket\":%I64u}", ticket);
      return true;
   }
   err = "不支持的交易指令: " + op;
   return false;
}

bool BridgeHandlePayload(const string cmd, const string symbol, const string ackFile)
{
   string id = BridgeExtractJsonString(cmd, "id");
   string op = BridgeExtractJsonString(cmd, "op");
   if(StringLen(id)==0 || StringLen(op)==0) return false;
   if(op=="bars")
   {
      string tf = BridgeExtractJsonString(cmd, "timeframe");
      int count = (int)BridgeExtractJsonNumber(cmd, "count");
      if(count<=0) count=500;
      if(count>800) count=800;
      string barSym = BridgeExtractJsonString(cmd, "symbol");
      if(StringLen(barSym) < 2) barSym = symbol;
      if(!SymbolSelect(barSym, true)) barSym = symbol;
      string bars = BridgeBuildBarsJson(barSym, tf, count);
      if(StringLen(bars)==0)
         BridgeWriteAckFile(ackFile, id, false, "{}", "copy_rates failed");
      else
         BridgeWriteAckFile(ackFile, id, true, bars, "");
      return true;
   }
   string result = "";
   string err = "";
   if(BridgeExecTrade(cmd, op, symbol, result, err))
      BridgeWriteAckFile(ackFile, id, true, result, "");
   else
      BridgeWriteAckFile(ackFile, id, false, "{}", err);
   return true;
}

bool BridgeProcessTrade(const string symbol)
{
   string cmd = BridgeReadWholeFileCommon(BRIDGE_TRADE_FILE);
   if(StringLen(cmd)<3) return false;
   BridgeFileDeleteCommon(BRIDGE_TRADE_FILE);
   g_latency_trace_id = BridgeExtractJsonString(cmd, "trace_id");
   g_latency_ea_us0 = GetMicrosecondCount();
   long gwWrite = (long)BridgeExtractJsonNumber(cmd, "gw_t_cmd_write_ms");
   string op = BridgeExtractJsonString(cmd, "op");
   BridgeLatencyAppend("ea_trade_file_read", op, g_latency_ea_us0, gwWrite, BridgeLocalMsNow());
   string sym = BridgeExtractJsonString(cmd, "symbol");
   if(StringLen(sym) < 2) sym = symbol;
   BridgeHandlePayload(cmd, sym, BRIDGE_TRADE_ACK);
   BridgeLatencyAppend("ea_trade_done", op, GetMicrosecondCount(), gwWrite, BridgeLocalMsNow());
   return true;
}

void BridgeProcessCommand(const string symbol)
{
   BridgeProcessTrade(symbol);
   if(FileIsExist(BRIDGE_TRADE_FILE, FILE_COMMON)) return;
   string cmd = BridgeReadWholeFileCommon(BRIDGE_CMD_FILE);
   if(StringLen(cmd)<3) return;
   BridgeFileDeleteCommon(BRIDGE_CMD_FILE);
   BridgeHandlePayload(cmd, symbol, BRIDGE_ACK_FILE);
}

#endif
