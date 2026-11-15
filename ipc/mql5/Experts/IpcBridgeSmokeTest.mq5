//+------------------------------------------------------------------+
//| IpcBridgeSmokeTest.mq5 — 烟囱测试：EA → DLL → Python 服务端       |
//+------------------------------------------------------------------+
#property copyright "XauDesk"
#property version   "1.00"
#property strict

#include <Mt5IpcBridge.mqh>

input string InpSocketPath = "/tmp/mt5_bridge.sock";
input int    InpPingMs     = 500;

int OnInit()
{
   if(!IpcEnsureConnected(InpSocketPath))
   {
      Print("IpcSmoke: connect failed; try Z:\\tmp\\mt5_bridge.sock on Wine");
      return INIT_FAILED;
   }
   EventSetMillisecondTimer(InpPingMs);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Mt5IpcDisconnect();
}

void OnTimer()
{
   string payload = StringFormat(
      "{\"op\":\"ping\",\"ts\":%I64d,\"sym\":\"%s\"}",
      (long)TimeGMT(),
      _Symbol);
   if(!IpcSendJson(InpSocketPath, payload))
      return;
   const string reply = IpcTryRecv(8192);
   if(StringLen(reply) > 0)
      Comment("Ipc OK: ", reply);
}