//+------------------------------------------------------------------+
//| BridgeState.mqh · 账户快照 JSON（持仓/挂单，含外部平仓校验）        |
//+------------------------------------------------------------------+
#ifndef XAUDESK_BRIDGE_STATE_MQH
#define XAUDESK_BRIDGE_STATE_MQH

string BridgeStateJsonEscape(const string s)
{
   string o="";
   const int n=(int)StringLen(s);
   for(int i=0;i<n;i++)
   {
      const ushort c=StringGetCharacter(s,i);
      if(c=='\\') o+="\\\\";
      else if(c=='"') o+="\\\"";
      else if(c=='\n') o+="\\n";
      else o+=ShortToString(c);
   }
   return o;
}

bool BridgePositionStillOpen(const ulong ticket)
{
   if(ticket == 0 || !PositionSelectByTicket(ticket))
      return false;
   double vol = PositionGetDouble(POSITION_VOLUME);
   if(vol <= 0.0)
      return false;

   const ulong pos_id = PositionGetInteger(POSITION_IDENTIFIER);
   const datetime from = (datetime)(TimeCurrent() - 86400 * 30);
   if(!HistorySelect(from, TimeCurrent()))
      return true;

   double closed_vol = 0.0;
   const int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      const ulong deal_ticket = HistoryDealGetTicket(i);
      if(deal_ticket == 0) continue;
      if(HistoryDealGetInteger(deal_ticket, DEAL_POSITION_ID) != pos_id) continue;
      if(HistoryDealGetInteger(deal_ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      closed_vol += HistoryDealGetDouble(deal_ticket, DEAL_VOLUME);
   }
   if(closed_vol >= vol - 1e-6)
      return false;
   return true;
}

string BridgeBuildPositionsJson()
{
   HistorySelect((datetime)(TimeCurrent() - 86400 * 14), TimeCurrent());

   string positions = "[";
   int pn = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      const ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !BridgePositionStillOpen(ticket))
         continue;
      if(!PositionSelectByTicket(ticket)) continue;

      const string psym = PositionGetString(POSITION_SYMBOL);
      const string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
      const double slp = PositionGetDouble(POSITION_SL);
      const double tpp = PositionGetDouble(POSITION_TP);
      if(pn > 0) positions += ",";
      positions += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%.2f,\"open_price\":%.5f,\"sl\":%s,\"tp\":%s,\"profit\":%.2f,\"open_time\":%I64d}",
         ticket, BridgeStateJsonEscape(psym), side, PositionGetDouble(POSITION_VOLUME),
         PositionGetDouble(POSITION_PRICE_OPEN),
         (slp > 0 ? StringFormat("%.5f", slp) : "null"),
         (tpp > 0 ? StringFormat("%.5f", tpp) : "null"),
         PositionGetDouble(POSITION_PROFIT),
         (long)PositionGetInteger(POSITION_TIME)
      );
      pn++;
   }
   positions += "]";
   return positions;
}

string BridgeBuildOrdersJson()
{
   string orders = "[";
   int on = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      const ulong ot = OrderGetTicket(i);
      if(ot == 0 || !OrderSelect(ot)) continue;
      const string osym = OrderGetString(ORDER_SYMBOL);
      const ENUM_ORDER_TYPE typ = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      const string oside = (typ==ORDER_TYPE_BUY_LIMIT || typ==ORDER_TYPE_BUY_STOP || typ==ORDER_TYPE_BUY_STOP_LIMIT) ? "buy" : "sell";
      string omode = "limit";
      if(typ==ORDER_TYPE_BUY_STOP || typ==ORDER_TYPE_SELL_STOP) omode = "stop";
      if(typ==ORDER_TYPE_BUY_STOP_LIMIT || typ==ORDER_TYPE_SELL_STOP_LIMIT) omode = "stop_limit";
      const double osl = OrderGetDouble(ORDER_SL);
      const double otp = OrderGetDouble(ORDER_TP);
      if(on > 0) orders += ",";
      orders += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"mode\":\"%s\",\"lots\":%.2f,\"price\":%.5f,\"sl\":%s,\"tp\":%s,\"setup_time\":%I64d}",
         ot, BridgeStateJsonEscape(osym), oside, omode,
         OrderGetDouble(ORDER_VOLUME_CURRENT),
         OrderGetDouble(ORDER_PRICE_OPEN),
         (osl > 0 ? StringFormat("%.5f", osl) : "null"),
         (otp > 0 ? StringFormat("%.5f", otp) : "null"),
         (long)OrderGetInteger(ORDER_TIME_SETUP)
      );
      on++;
   }
   orders += "]";
   return orders;
}

#endif