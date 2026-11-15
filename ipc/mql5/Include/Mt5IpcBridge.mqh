//+------------------------------------------------------------------+
//| Mt5IpcBridge.mqh — #import Unix socket IPC DLL                   |
//+------------------------------------------------------------------+
#ifndef __MT5_IPC_BRIDGE_MQH__
#define __MT5_IPC_BRIDGE_MQH__

#property strict

#import "Mt5IpcBridge.dll"
   int Mt5IpcConnect(string socket_path);
   int Mt5IpcSend(string msg);
   int Mt5IpcRecv(uchar &buffer[], int max_len);
   int Mt5IpcDisconnect();
   int Mt5IpcIsConnected();
#import

string IpcReadCString(const uchar &buf[], const int len)
{
   if(len <= 0) return "";
   uchar tmp[];
   ArrayResize(tmp, len + 1);
   ArrayCopy(tmp, buf, 0, 0, len);
   tmp[len] = 0;
   return CharArrayToString(tmp, 0, WHOLE_ARRAY, CP_UTF8);
}

bool IpcEnsureConnected(const string path)
{
   if(Mt5IpcIsConnected() == 1) return true;
   return Mt5IpcConnect(path) == 1;
}

bool IpcSendJson(const string path, const string compact_json)
{
   if(!IpcEnsureConnected(path))
   {
      Print("Ipc: connect failed path=", path, " err=", GetLastError());
      return false;
   }
   const int n = Mt5IpcSend(compact_json);
   if(n < 0)
   {
      Print("Ipc: send failed err=", GetLastError());
      Mt5IpcDisconnect();
      return false;
   }
   return true;
}

string IpcTryRecv(const int max_len = 4096)
{
   uchar buf[];
   ArrayResize(buf, max_len);
   const int n = Mt5IpcRecv(buf, max_len);
   if(n > 0) return IpcReadCString(buf, n);
   return "";
}

#endif