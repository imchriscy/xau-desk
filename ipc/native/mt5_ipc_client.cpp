/**
 * Mt5IpcBridge.dll — AF_UNIX SOCK_STREAM client
 * 帧：uint32_le(len) + payload
 *
 * Windows / Wine：Winsock2 + AF_UNIX（Win10 1803+；Wine 对 UDS 有实现）
 * 本机 POSIX：可直接 g++ -shared 编成 .so 做协议测试
 */
#include "mt5_ipc_client.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "ws2_32.lib")
// mingw-w64 可能提供 afunix.h
#  if __has_include(<afunix.h>)
#    include <afunix.h>
#  else
#    ifndef AF_UNIX
#      define AF_UNIX 1
#    endif
#    struct sockaddr_un {
#      ADDRESS_FAMILY sun_family;
#      char sun_path[108];
#    };
#  endif
   using sock_fd_t = SOCKET;
#  define IPC_INVALID_SOCK INVALID_SOCKET
#  define ipc_close closesocket
#  define ipc_last_err() WSAGetLastError()
#else
#  include <arpa/inet.h>
#  include <cerrno>
#  include <fcntl.h>
#  include <sys/socket.h>
#  include <sys/un.h>
#  include <unistd.h>
   using sock_fd_t = int;
#  define IPC_INVALID_SOCK (-1)
#  define ipc_close ::close
#  define ipc_last_err() errno
#endif

namespace {

sock_fd_t g_sock = IPC_INVALID_SOCK;
std::vector<char> g_rxbuf;
bool g_wsa_inited = false;

constexpr uint32_t kMaxFrame = 1024 * 1024;

#if defined(_WIN32)
bool ensure_wsa() {
  if (g_wsa_inited) return true;
  WSADATA wsa{};
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
  g_wsa_inited = true;
  return true;
}
#endif

bool set_nonblocking(sock_fd_t s) {
#if defined(_WIN32)
  u_long mode = 1;
  return ioctlsocket(s, FIONBIO, &mode) == 0;
#else
  int f = fcntl(s, F_GETFL, 0);
  if (f < 0) return false;
  return fcntl(s, F_SETFL, f | O_NONBLOCK) == 0;
#endif
}

bool connect_unix(const char* path) {
#if defined(_WIN32)
  if (!ensure_wsa()) return false;
#endif
  if (!path || !path[0]) return false;

  sock_fd_t s = socket(AF_UNIX, SOCK_STREAM, 0);
  if (s == IPC_INVALID_SOCK) return false;

  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  const size_t cap = sizeof(addr.sun_path) - 1;
  const size_t n = std::strlen(path);
  if (n > cap) {
    ipc_close(s);
    return false;
  }
  std::memcpy(addr.sun_path, path, n);
  addr.sun_path[n] = '\0';

  if (connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    ipc_close(s);
    return false;
  }
  if (!set_nonblocking(s)) {
    ipc_close(s);
    return false;
  }
  g_sock = s;
  g_rxbuf.clear();
  return true;
}

int send_all(sock_fd_t s, const char* data, size_t len) {
  size_t off = 0;
  while (off < len) {
#if defined(_WIN32)
    const int n = send(s, data + off, static_cast<int>(len - off), 0);
#else
    const ssize_t n = ::send(s, data + off, len - off, MSG_NOSIGNAL);
#endif
    if (n <= 0) return -1;
    off += static_cast<size_t>(n);
  }
  return static_cast<int>(off);
}

int recv_some(sock_fd_t s, char* buf, int cap) {
#if defined(_WIN32)
  return recv(s, buf, cap, 0);
#else
  return static_cast<int>(::recv(s, buf, cap, 0));
#endif
}

}  // namespace

extern "C" {

MT5IPC_API int MT5IPC_CALL Mt5IpcConnect(const char* socket_path) {
  Mt5IpcDisconnect();
  return connect_unix(socket_path) ? 1 : 0;
}

MT5IPC_API int MT5IPC_CALL Mt5IpcDisconnect(void) {
  if (g_sock != IPC_INVALID_SOCK) {
    ipc_close(g_sock);
    g_sock = IPC_INVALID_SOCK;
  }
  g_rxbuf.clear();
#if defined(_WIN32)
  if (g_wsa_inited) {
    WSACleanup();
    g_wsa_inited = false;
  }
#endif
  return 1;
}

MT5IPC_API int MT5IPC_CALL Mt5IpcIsConnected(void) {
  return g_sock != IPC_INVALID_SOCK ? 1 : 0;
}

MT5IPC_API int MT5IPC_CALL Mt5IpcSend(const char* msg) {
  if (g_sock == IPC_INVALID_SOCK || !msg) return -1;
  const size_t payload_len = std::strlen(msg);
  if (payload_len > kMaxFrame) return -1;

  uint32_t le = static_cast<uint32_t>(payload_len);
  char hdr[4];
  std::memcpy(hdr, &le, 4);

  if (send_all(g_sock, hdr, 4) != 4) return -1;
  if (payload_len == 0) return 4;
  const int sent = send_all(g_sock, msg, payload_len);
  if (sent < 0) return -1;
  return 4 + sent;
}

MT5IPC_API int MT5IPC_CALL Mt5IpcRecv(char* buffer, int max_len) {
  if (g_sock == IPC_INVALID_SOCK || !buffer || max_len <= 0) return -1;

  char chunk[4096];
  for (;;) {
    const int n = recv_some(g_sock, chunk, static_cast<int>(sizeof(chunk)));
    if (n > 0) {
      g_rxbuf.insert(g_rxbuf.end(), chunk, chunk + n);
    } else if (n == 0) {
      Mt5IpcDisconnect();
      return -1;
    } else {
#if defined(_WIN32)
      const int e = ipc_last_err();
      if (e == WSAEWOULDBLOCK) break;
#else
      if (ipc_last_err() == EAGAIN || ipc_last_err() == EWOULDBLOCK) break;
#endif
      return -1;
    }
  }

  if (g_rxbuf.size() < 4) return 0;

  uint32_t need = 0;
  std::memcpy(&need, g_rxbuf.data(), 4);
  if (need > kMaxFrame) {
    g_rxbuf.clear();
    return -1;
  }
  const size_t total = 4u + need;
  if (g_rxbuf.size() < total) return 0;

  const size_t copy_len = (need < static_cast<uint32_t>(max_len - 1))
                              ? need
                              : static_cast<uint32_t>(max_len - 1);
  std::memcpy(buffer, g_rxbuf.data() + 4, copy_len);
  buffer[copy_len] = '\0';

  g_rxbuf.erase(g_rxbuf.begin(), g_rxbuf.begin() + static_cast<long>(total));
  return static_cast<int>(copy_len);
}

}  // extern "C"