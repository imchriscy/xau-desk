//+------------------------------------------------------------------+
//| FastLane.mqh · TCP :5192 固定帧 → 同进程 OrderSend                |
//+------------------------------------------------------------------+
#ifndef __XAU_FAST_LANE_MQH__
#define __XAU_FAST_LANE_MQH__

#define FAST_MAGIC "XDF1"
#define FAST_FRAME_LEN 48
#define FAST_ACK_LEN 16

int    g_fast_sock = INVALID_HANDLE;
int    g_fast_port = 5192;

float BytesToFloat(const uchar &b[], const int off)
{
   union { uchar c[4]; float f; } u;
   for(int i=0;i<4;i++) u.c[i] = b[off+i];
   return u.f;
}

double BytesToDouble(const uchar &b[], const int off)
{
   union { uchar c[8]; double d; } u;
   for(int i=0;i<8;i++) u.c[i] = b[off+i];
   return u.d;
}

bool FastLaneBind(const int port)
{
   g_fast_port = port;
   if(g_fast_sock != INVALID_HANDLE) SocketClose(g_fast_sock);
   g_fast_sock = SocketCreate();
   if(g_fast_sock == INVALID_HANDLE) return false;
   if(!SocketBind(g_fast_sock, "127.0.0.1", (uint)g_fast_port))
   {
      SocketClose(g_fast_sock);
      g_fast_sock = INVALID_HANDLE;
      return false;
   }
   if(!SocketListen(g_fast_sock, 8))
   {
      SocketClose(g_fast_sock);
      g_fast_sock = INVALID_HANDLE;
      return false;
   }
   return true;
}

void FastLaneShutdown()
{
   if(g_fast_sock != INVALID_HANDLE)
   {
      SocketClose(g_fast_sock);
      g_fast_sock = INVALID_HANDLE;
   }
}

bool FastLaneWriteAck(const int client, const bool ok, const uint retcode, const ulong ticket)
{
   uchar ack[16];
   StringToCharArray(FAST_MAGIC, ack, 0, 4);
   ack[4] = ok ? 1 : 0;
   ack[5] = (uchar)(retcode & 0xFF);
   ack[6] = (uchar)((retcode >> 8) & 0xFF);
   ack[7] = (uchar)((retcode >> 16) & 0xFF);
   ack[8] = (uchar)((retcode >> 24) & 0xFF);
   for(int i=0;i<8;i++)
      ack[9+i] = (uchar)((ticket >> (8*i)) & 0xFF);
   return SocketSend(client, ack, 16) == 16;
}

void FastLanePoll(const int magic, const double default_sl_points)
{
   if(g_fast_sock == INVALID_HANDLE) return;
   int client = SocketAccept(g_fast_sock, 1);
   if(client == INVALID_HANDLE) return;

   uchar buf[FAST_FRAME_LEN];
   int got = SocketRead(client, buf, FAST_FRAME_LEN, 50);
   if(got < FAST_FRAME_LEN)
   {
      FastLaneWriteAck(client, false, 0, 0);
      SocketClose(client);
      return;
   }

   string magic;
   magic = CharArrayToString(buf, 0, 4);
   if(magic != FAST_MAGIC)
   {
      FastLaneWriteAck(client, false, 0, 0);
      SocketClose(client);
      return;
   }

   uchar op = buf[4];
   bool is_buy = (buf[5] == 0);
   bool allow_demo = ((buf[6] & 1) != 0);
   bool prev_demo = g_allow_demo;
   if(allow_demo) g_allow_demo = true;

   float lots_f = BytesToFloat(buf, 7);
   double sl = BytesToDouble(buf, 11);
   double tp = BytesToDouble(buf, 19);
   double price = BytesToDouble(buf, 27);
   ulong ticket = 0;
   for(int i=0;i<8;i++)
      ticket |= ((ulong)buf[35+i]) << (8*i);

   string err = "";
   bool ok = false;
   uint ret = 0;
   ulong out_ticket = 0;

   if(op == 1) // market
   {
      if(sl <= 0 && default_sl_points > 0)
         sl = DefaultSlPrice(is_buy, default_sl_points);
      if(RiskPrecheckMarket(is_buy, sl, err))
         ok = ExecMarket(magic, is_buy, (double)lots_f, sl, tp, err);
   }
   else if(op == 2) // close
   {
      if(RiskPrecheckClose(err))
      {
         double cp = 0;
         ok = ExecClose(magic, ticket, err, cp);
      }
   }
   else if(op == 3) // pending limit
   {
      if(sl <= 0 && default_sl_points > 0)
         sl = DefaultSlPrice(is_buy, default_sl_points);
      if(RiskPrecheckMarket(is_buy, sl, err))
         ok = ExecPendingLimit(magic, is_buy, (double)lots_f, price, sl, tp, err);
   }
   else if(op == 4) // modify
      ok = ExecModifySlTp(magic, ticket, sl, tp, err);
   else
      err = "bad_op";

   g_allow_demo = prev_demo;
   ret = ok ? (uint)TRADE_RETCODE_DONE : (uint)TRADE_RETCODE_REJECT;
   FastLaneWriteAck(client, ok, ret, out_ticket);
   SocketClose(client);
}

#endif
