/* Mt5IpcBridge — Unix domain socket client for MQL5 #import */
#ifndef MT5_IPC_CLIENT_H
#define MT5_IPC_CLIENT_H

#ifdef _WIN32
#  ifdef MT5IPC_EXPORTS
#    define MT5IPC_API __declspec(dllexport)
#  else
#    define MT5IPC_API __declspec(dllimport)
#  endif
#  define MT5IPC_CALL __stdcall
#else
#  define MT5IPC_API
#  define MT5IPC_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

/** 连接 UDS。返回 1 成功，0 失败。（避开 Win32 SendMessage 宏） */
MT5IPC_API int MT5IPC_CALL Mt5IpcConnect(const char* socket_path);

/** 发送一帧（内部加 4 字节长度头）。返回发送字节数（含头）或 -1。 */
MT5IPC_API int MT5IPC_CALL Mt5IpcSend(const char* msg);

/**
 * 非阻塞读取一帧到 buffer（仅 payload，不含长度头）。
 * 返回 >0 为 payload 长度；0 表示暂无完整帧；<0 错误。
 */
MT5IPC_API int MT5IPC_CALL Mt5IpcRecv(char* buffer, int max_len);

/** 断开并释放 socket。 */
MT5IPC_API int MT5IPC_CALL Mt5IpcDisconnect(void);

/** 查询是否已连接。返回 1/0。 */
MT5IPC_API int MT5IPC_CALL Mt5IpcIsConnected(void);

#ifdef __cplusplus
}
#endif

#endif