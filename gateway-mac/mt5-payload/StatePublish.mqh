//+------------------------------------------------------------------+
//| StatePublish.mqh · xau_state.bin 展示路径（非热路径）              |
//+------------------------------------------------------------------+
#ifndef __XAU_STATE_PUBLISH_MQH__
#define __XAU_STATE_PUBLISH_MQH__

#define STATE_BIN_FILE "xau_state.bin"
#define STATE_HDR 128
#define STATE_POS_SLOT 64
#define STATE_MAX_POS 32

void DoubleToBytes(const double d, uchar &out[])
{
   union { uchar c[8]; double v; } u;
   u.v = d;
   ArrayResize(out, 8);
   for(int i=0;i<8;i++) out[i] = u.c[i];
}

void FloatToBytes(const float f, uchar &out[])
{
   union { uchar c[4]; float v; } u;
   u.v = f;
   ArrayResize(out, 4);
   for(int i=0;i<4;i++) out[i] = u.c[i];
}

bool StateWriteBin(const int magic)
{
   uchar buf[STATE_HDR + STATE_MAX_POS * STATE_POS_SLOT];
   ArrayInitialize(buf, 0);

   StringToCharArray("XAU1", buf, 0, 4);
   buf[4] = 1; buf[5] = 0; // ver LE 1

   double ts = (double)TimeCurrent();
   uchar tsb[8];
   DoubleToBytes(ts, tsb);
   for(int i=0;i<8;i++) buf[8+i] = tsb[i];

   StringToCharArray(g_sym, buf, 16, 16);
   DoubleToBytes(g_tick.bid, tsb);
   for(int i=0;i<8;i++) buf[32+i] = tsb[i];
   DoubleToBytes(g_tick.ask, tsb);
   for(int i=0;i<8;i++) buf[40+i] = tsb[i];

   float ms = 0.05f;
   uchar msb[4];
   FloatToBytes(ms, msb);
   for(int i=0;i<4;i++) buf[48+i] = msb[i];

   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   for(int i=0;i<8;i++) buf[52+i] = (uchar)((login >> (8*i)) & 0xFF);

   DoubleToBytes(AccountInfoDouble(ACCOUNT_EQUITY), tsb);
   for(int i=0;i<8;i++) buf[60+i] = tsb[i];
   DoubleToBytes(AccountInfoDouble(ACCOUNT_BALANCE), tsb);
   for(int i=0;i<8;i++) buf[68+i] = tsb[i];
   DoubleToBytes(AccountInfoDouble(ACCOUNT_MARGIN), tsb);
   for(int i=0;i<8;i++) buf[76+i] = tsb[i];
   DoubleToBytes(AccountInfoDouble(ACCOUNT_MARGIN_FREE), tsb);
   for(int i=0;i<8;i++) buf[84+i] = tsb[i];
   DoubleToBytes(AccountInfoDouble(ACCOUNT_PROFIT), tsb);
   for(int i=0;i<8;i++) buf[92+i] = tsb[i];

   int lev = (int)AccountInfoInteger(ACCOUNT_LEVERAGE);
   buf[100] = (uchar)(lev & 0xFF);
   buf[101] = (uchar)((lev >> 8) & 0xFF);
   buf[102] = (uchar)((lev >> 16) & 0xFF);
   buf[103] = (uchar)((lev >> 24) & 0xFF);

   buf[104] = RiskIsArmed() ? 1 : 0;
   buf[105] = RiskIsHalted() ? 1 : 0;

   int pcount = 0;
   int base = STATE_HDR;
   for(int i = PositionsTotal() - 1; i >= 0 && pcount < STATE_MAX_POS; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_sym) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != magic) continue;

      int off = base + pcount * STATE_POS_SLOT;
      ulong t = PositionGetInteger(POSITION_TICKET);
      for(int k=0;k<8;k++) buf[off+k] = (uchar)((t >> (8*k)) & 0xFF);
      buf[off+8] = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 0 : 1;
      float lots = (float)PositionGetDouble(POSITION_VOLUME);
      FloatToBytes(lots, msb);
      for(int k=0;k<4;k++) buf[off+9+k] = msb[k];
      DoubleToBytes(PositionGetDouble(POSITION_PRICE_OPEN), tsb);
      for(int k=0;k<8;k++) buf[off+13+k] = tsb[k];
      DoubleToBytes(PositionGetDouble(POSITION_SL), tsb);
      for(int k=0;k<8;k++) buf[off+21+k] = tsb[k];
      DoubleToBytes(PositionGetDouble(POSITION_TP), tsb);
      for(int k=0;k<8;k++) buf[off+29+k] = tsb[k];
      DoubleToBytes(PositionGetDouble(POSITION_PROFIT), tsb);
      for(int k=0;k<8;k++) buf[off+37+k] = tsb[k];
      pcount++;
   }

   buf[106] = (uchar)(pcount & 0xFF);
   buf[107] = (uchar)((pcount >> 8) & 0xFF);

   int total = STATE_HDR + pcount * STATE_POS_SLOT;
   int h = FileOpen(STATE_BIN_FILE, FILE_WRITE|FILE_BIN|FILE_COMMON);
   if(h == INVALID_HANDLE) return false;
   FileWriteArray(h, buf, 0, total);
   FileClose(h);
   return true;
}

#endif
