// SMT 手机端静态页面服务（原生 x64 DLL 插件）
// 与 plugins/webcontroler.dll 的结构保持一致：
//   - 加载 DLL 后自动在后台线程启动 HTTP 静态服务
//   - 只导出 onExit()，宿主卸载插件时调用
//   - 前端页面作为 RCDATA 资源打包在 DLL 内（由 build.ps1 生成 assets.rc）
//
// 默认端口 81；可在 DLL 同目录放一个 smtweb.port 文本文件覆盖（只写数字）。

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <string>
#include <vector>

#include "assets_g.h"
#include "qrcodegen.hpp"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "iphlpapi.lib")

namespace {

const int kDefaultPort = 81;
const int kMaxHeaderBytes = 16 * 1024;
const int kIoTimeoutMs = 5000;

volatile LONG g_stop = 0;
HANDLE g_thread = NULL;
HANDLE g_uiThread = NULL;
SOCKET g_listenSocket = INVALID_SOCKET;
SOCKET g_clientSocket = INVALID_SOCKET;
HMODULE g_module = NULL;

int g_port = kDefaultPort;
HWND g_window = NULL;
qrcodegen::QrCode* g_qr = NULL;
std::wstring g_url;
HFONT g_fontAddress = NULL;
HFONT g_fontHint = NULL;
/** onExit 触发的关闭只允许执行一次自卸载 */
volatile LONG g_shutdownStarted = 0;

void WriteLog(const char* format, ...)
{
    char message[1024];
    va_list args;
    va_start(args, format);
    vsnprintf_s(message, _TRUNCATE, format, args);
    va_end(args);

    // 只输出到调试器，不再写日志文件
    OutputDebugStringA("[smtweb] ");
    OutputDebugStringA(message);
    OutputDebugStringA("\n");
}

std::string Lower(std::string value)
{
    for (size_t i = 0; i < value.size(); ++i)
    {
        char c = value[i];
        if (c >= 'A' && c <= 'Z') value[i] = (char)(c - 'A' + 'a');
    }
    return value;
}

std::string UrlDecode(const std::string& value)
{
    std::string out;
    out.reserve(value.size());
    for (size_t i = 0; i < value.size(); ++i)
    {
        char c = value[i];
        if (c == '%' && i + 2 < value.size())
        {
            int high = 0;
            int low = 0;
            char h = value[i + 1];
            char l = value[i + 2];
            if (h >= '0' && h <= '9') high = h - '0';
            else if (h >= 'a' && h <= 'f') high = h - 'a' + 10;
            else if (h >= 'A' && h <= 'F') high = h - 'A' + 10;
            else { out.push_back(c); continue; }
            if (l >= '0' && l <= '9') low = l - '0';
            else if (l >= 'a' && l <= 'f') low = l - 'a' + 10;
            else if (l >= 'A' && l <= 'F') low = l - 'A' + 10;
            else { out.push_back(c); continue; }
            out.push_back((char)((high << 4) | low));
            i += 2;
        }
        else
        {
            out.push_back(c);
        }
    }
    return out;
}

int ReadPort()
{
    wchar_t path[MAX_PATH];
    if (GetModuleFileNameW(g_module, path, MAX_PATH) == 0) return kDefaultPort;
    wchar_t* slash = wcsrchr(path, L'\\');
    if (slash == NULL) return kDefaultPort;
    *(slash + 1) = 0;
    wcscat_s(path, MAX_PATH, L"smtweb.port");

    FILE* file = NULL;
    if (_wfopen_s(&file, path, L"rt") != 0 || file == NULL) return kDefaultPort;
    int port = 0;
    int matched = fwscanf_s(file, L"%d", &port);
    fclose(file);
    if (matched != 1 || port <= 0 || port > 65535) return kDefaultPort;
    return port;
}

bool LoadAsset(const std::string& path, const void** data, DWORD* size)
{
    for (int i = 0; i < kAssetCount; ++i)
    {
        if (_stricmp(kAssets[i].path, path.c_str()) != 0) continue;
        HRSRC resource = FindResourceW(g_module, MAKEINTRESOURCEW(kAssets[i].id), RT_RCDATA);
        if (resource == NULL) return false;
        HGLOBAL handle = LoadResource(g_module, resource);
        if (handle == NULL) return false;
        *data = LockResource(handle);
        *size = SizeofResource(g_module, resource);
        return *data != NULL && *size > 0;
    }
    return false;
}

const char* ContentTypeOf(const std::string& path)
{
    size_t dot = path.find_last_of('.');
    std::string ext = dot == std::string::npos ? "" : Lower(path.substr(dot));
    if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
    if (ext == ".js" || ext == ".mjs") return "text/javascript; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".json" || ext == ".map") return "application/json; charset=utf-8";
    if (ext == ".txt") return "text/plain; charset=utf-8";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif") return "image/gif";
    if (ext == ".webp") return "image/webp";
    if (ext == ".ico") return "image/x-icon";
    if (ext == ".woff") return "font/woff";
    if (ext == ".woff2") return "font/woff2";
    if (ext == ".ttf") return "font/ttf";
    if (ext == ".otf") return "font/otf";
    if (ext == ".wasm") return "application/wasm";
    return "application/octet-stream";
}

bool NormalizePath(const std::string& raw, std::string& out)
{
    std::string value = raw;
    size_t stop = value.find_first_of("?#");
    if (stop != std::string::npos) value = value.substr(0, stop);

    if (value.compare(0, 7, "http://") == 0 || value.compare(0, 8, "https://") == 0)
    {
        size_t hostEnd = value.find("//");
        hostEnd = hostEnd == std::string::npos ? std::string::npos : hostEnd + 2;
        size_t slash = value.find('/', hostEnd);
        value = slash == std::string::npos ? "/" : value.substr(slash);
    }

    value = UrlDecode(value);
    for (size_t i = 0; i < value.size(); ++i)
        if (value[i] == '\\') value[i] = '/';

    if (value.empty()) value = "/";
    if (value[0] != '/') value.insert(value.begin(), '/');
    if (value.find("..") != std::string::npos) return false;
    if (value == "/") value = "/index.html";
    out = value;
    return true;
}

bool SendAll(SOCKET socket, const char* data, int length)
{
    while (length > 0)
    {
        int sent = send(socket, data, length, 0);
        if (sent <= 0) return false;
        data += sent;
        length -= sent;
    }
    return true;
}

void SendResponse(SOCKET socket, int status, const char* reason, const char* contentType,
                  const void* body, DWORD bodyLength, bool headOnly, const char* cache)
{
    char header[512];
    int headerLength = _snprintf_s(header, sizeof(header), _TRUNCATE,
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %lu\r\n"
        "Cache-Control: %s\r\n"
        "Connection: close\r\n"
        "X-Content-Type-Options: nosniff\r\n\r\n",
        status, reason, contentType, (unsigned long)bodyLength, cache);

    if (headerLength <= 0) return;
    if (!SendAll(socket, header, headerLength)) return;
    if (!headOnly && bodyLength > 0) SendAll(socket, (const char*)body, (int)bodyLength);
}

std::string ReadHeaders(SOCKET socket)
{
    std::string data;
    char buffer[4096];
    while ((int)data.size() < kMaxHeaderBytes)
    {
        int received = recv(socket, buffer, sizeof(buffer), 0);
        if (received <= 0) break;
        data.append(buffer, received);
        if (data.find("\r\n\r\n") != std::string::npos) break;
    }
    return data;
}

void HandleClient(SOCKET socket)
{
    DWORD timeout = kIoTimeoutMs;
    setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));

    std::string request = ReadHeaders(socket);
    size_t lineEnd = request.find("\r\n");
    std::string line = lineEnd == std::string::npos ? request : request.substr(0, lineEnd);

    size_t firstSpace = line.find(' ');
    size_t secondSpace = firstSpace == std::string::npos ? std::string::npos : line.find(' ', firstSpace + 1);
    if (firstSpace == std::string::npos || secondSpace == std::string::npos)
    {
        const char* message = "Bad Request";
        SendResponse(socket, 400, message, "text/plain; charset=utf-8", message, 11, false, "no-cache");
        return;
    }

    std::string method = line.substr(0, firstSpace);
    std::string target = line.substr(firstSpace + 1, secondSpace - firstSpace - 1);
    bool headOnly = _stricmp(method.c_str(), "HEAD") == 0;

    if (_stricmp(method.c_str(), "GET") != 0 && !headOnly)
    {
        const char* message = "Method Not Allowed";
        SendResponse(socket, 405, message, "text/plain; charset=utf-8", message, 18, false, "no-cache");
        return;
    }

    std::string path;
    if (!NormalizePath(target, path))
    {
        const char* message = "Bad Request";
        SendResponse(socket, 400, message, "text/plain; charset=utf-8", message, 11, false, "no-cache");
        return;
    }

    const void* body = NULL;
    DWORD bodyLength = 0;
    if (!LoadAsset(path, &body, &bodyLength))
    {
        // 前端路由回退：没有扩展名的路径返回 index.html
        std::string name = path.substr(path.find_last_of('/') + 1);
        if (name.find('.') == std::string::npos)
        {
            if (!LoadAsset("/index.html", &body, &bodyLength))
            {
                const char* message = "Not Found";
                SendResponse(socket, 404, message, "text/plain; charset=utf-8", message, 9, false, "no-cache");
                return;
            }
            path = "/index.html";
        }
        else
        {
            const char* message = "Not Found";
            SendResponse(socket, 404, message, "text/plain; charset=utf-8", message, 9, false, "no-cache");
            return;
        }
    }

    const char* cache = path.compare(0, 8, "/assets/") == 0
        ? "public, max-age=31536000, immutable"
        : "no-cache";
    SendResponse(socket, 200, "OK", ContentTypeOf(path), body, bodyLength, headOnly, cache);
}

/* ---------------- 控制窗口：显示地址与二维码 ---------------- */

const int kClientWidth = 380;
const int kClientHeight = 486;

/** 插件卸载时由服务线程通知窗口退出 */
const UINT kCloseWindowMessage = WM_APP + 1;

/** 网卡名称/描述里出现这些词，基本可以判定是虚拟或 VPN 网卡 */
bool IsVirtualAdapter(const wchar_t* text)
{
    static const wchar_t* const kKeywords[] = {
        L"vmware", L"virtual", L"hyper-v", L"vethernet", L"virtualbox",
        L"tap-", L"vpn", L"oray", L"tailscale", L"zerotier", L"wsl",
        L"docker", L"loopback", L"bluetooth", L"蓝牙",
    };
    if (text == NULL) return false;

    wchar_t lower[256];
    wcsncpy_s(lower, text, _TRUNCATE);
    _wcslwr_s(lower, wcslen(lower) + 1);

    for (int i = 0; i < (int)(sizeof(kKeywords) / sizeof(kKeywords[0])); ++i)
    {
        if (wcsstr(lower, kKeywords[i]) != NULL) return true;
    }
    return false;
}

std::string GetLanIp()
{
    ULONG size = 15 * 1024;
    std::vector<unsigned char> buffer;
    PIP_ADAPTER_ADDRESSES addresses = NULL;
    ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
                  GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS;
    ULONG result = ERROR_BUFFER_OVERFLOW;

    for (int attempt = 0; attempt < 2; ++attempt)
    {
        buffer.resize(size);
        addresses = (PIP_ADAPTER_ADDRESSES)&buffer[0];
        result = GetAdaptersAddresses(AF_INET, flags, NULL, addresses, &size);
        if (result != ERROR_BUFFER_OVERFLOW) break;
    }
    if (result != NO_ERROR || addresses == NULL) return "127.0.0.1";

    std::string best;
    int bestScore = 0x7FFFFFFF;
    for (PIP_ADAPTER_ADDRESSES adapter = addresses; adapter != NULL; adapter = adapter->Next)
    {
        if (adapter->OperStatus != IfOperStatusUp) continue;
        if (adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK) continue;

        // 有默认网关的通常是真正上外网的物理网卡
        int adapterScore = 0;
        if (adapter->FirstGatewayAddress == NULL) adapterScore += 100;
        if (adapter->IfType != IF_TYPE_ETHERNET_CSMACD && adapter->IfType != IF_TYPE_IEEE80211)
            adapterScore += 20;
        if (IsVirtualAdapter(adapter->FriendlyName) || IsVirtualAdapter(adapter->Description))
            adapterScore += 500;

        for (PIP_ADAPTER_UNICAST_ADDRESS item = adapter->FirstUnicastAddress; item != NULL; item = item->Next)
        {
            const sockaddr* address = item->Address.lpSockaddr;
            if (address == NULL || address->sa_family != AF_INET) continue;

            const unsigned char* bytes = (const unsigned char*)&((const sockaddr_in*)address)->sin_addr;
            if (bytes[0] == 169 && bytes[1] == 254) continue;  // 跳过 APIPA 地址

            char text[32];
            _snprintf_s(text, sizeof(text), _TRUNCATE, "%u.%u.%u.%u", bytes[0], bytes[1], bytes[2], bytes[3]);
            std::string ip(text);
            if (ip == "0.0.0.0" || ip == "127.0.0.1") continue;

            // 常见局域网网段优先
            int score = adapterScore;
            if (bytes[0] == 192 && bytes[1] == 168) score += 0;
            else if (bytes[0] == 10) score += 1;
            else if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) score += 2;
            else score += 3;

            if (score < bestScore)
            {
                bestScore = score;
                best = ip;
            }
        }
    }
    return best.empty() ? "127.0.0.1" : best;
}

std::wstring ToWide(const std::string& text)
{
    int length = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, NULL, 0);
    if (length <= 0) return L"";
    std::vector<wchar_t> buffer(length);
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, &buffer[0], length);
    return std::wstring(&buffer[0]);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam)
{
    switch (message)
    {
    case WM_CREATE:
        g_fontAddress = CreateFontW(-21, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
            DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
        g_fontHint = CreateFontW(-14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
            DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
        return 0;

    case WM_ERASEBKGND:
    {
        RECT rect;
        GetClientRect(window, &rect);
        FillRect((HDC)wparam, &rect, (HBRUSH)GetStockObject(WHITE_BRUSH));
        return 1;
    }

    case WM_PAINT:
    {
        PAINTSTRUCT paint;
        HDC dc = BeginPaint(window, &paint);
        RECT client;
        GetClientRect(window, &client);
        int width = client.right - client.left;

        FillRect(dc, &client, (HBRUSH)GetStockObject(WHITE_BRUSH));
        SetBkMode(dc, TRANSPARENT);

        HGDIOBJ oldFont = SelectObject(dc, g_fontAddress);
        SetTextColor(dc, RGB(18, 18, 18));
        RECT addressRect;
        addressRect.left = 12;
        addressRect.right = width - 12;
        addressRect.top = 16;
        addressRect.bottom = 50;
        DrawTextW(dc, g_url.c_str(), -1, &addressRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

        if (g_qr != NULL)
        {
            int modules = g_qr->getSize() + 8;  // 四周各留 4 格静区
            int scale = 300 / modules;
            if (scale < 2) scale = 2;
            int size = modules * scale;
            int left = (width - size) / 2;
            int top = 62;

            HPEN border = CreatePen(PS_SOLID, 1, RGB(220, 220, 220));
            HGDIOBJ oldPen = SelectObject(dc, border);
            HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(WHITE_BRUSH));
            Rectangle(dc, left - 2, top - 2, left + size + 2, top + size + 2);
            SelectObject(dc, oldBrush);
            SelectObject(dc, oldPen);
            DeleteObject(border);

            HBRUSH black = (HBRUSH)GetStockObject(BLACK_BRUSH);
            for (int y = 0; y < g_qr->getSize(); ++y)
            {
                for (int x = 0; x < g_qr->getSize(); ++x)
                {
                    if (!g_qr->getModule(x, y)) continue;
                    RECT cell;
                    cell.left = left + (x + 4) * scale;
                    cell.top = top + (y + 4) * scale;
                    cell.right = cell.left + scale;
                    cell.bottom = cell.top + scale;
                    FillRect(dc, &cell, black);
                }
            }

            SelectObject(dc, g_fontHint);
            SetTextColor(dc, RGB(110, 110, 110));
            RECT hint;
            hint.left = 12;
            hint.right = width - 12;
            hint.top = top + size + 14;
            hint.bottom = hint.top + 22;
            DrawTextW(dc, L"手机与电脑连接同一局域网", -1, &hint, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
            hint.top += 22;
            hint.bottom += 22;
            DrawTextW(dc, L"用手机扫描二维码打开控制页面", -1, &hint, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

            SetTextColor(dc, RGB(150, 150, 150));
            hint.top += 34;
            hint.bottom += 34;
            DrawTextW(dc, L"关闭窗口不会停止服务", -1, &hint, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
            hint.top += 22;
            hint.bottom += 22;
            DrawTextW(dc, L"停止服务请在插件页面取消勾选", -1, &hint, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        }

        SelectObject(dc, oldFont);
        EndPaint(window, &paint);
        return 0;
    }

    case WM_CLOSE:
        // 只关闭窗口，服务继续运行
        DestroyWindow(window);
        return 0;

    case kCloseWindowMessage:
        DestroyWindow(window);
        return 0;

    case WM_DESTROY:
        g_window = NULL;
        if (g_fontAddress != NULL) { DeleteObject(g_fontAddress); g_fontAddress = NULL; }
        if (g_fontHint != NULL) { DeleteObject(g_fontHint); g_fontHint = NULL; }
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProcW(window, message, wparam, lparam);
}

DWORD WINAPI UiThread(LPVOID)
{
    char url[128];
    std::string ip = GetLanIp();
    _snprintf_s(url, sizeof(url), _TRUNCATE, "http://%s:%d/", ip.c_str(), g_port);
    g_url = ToWide(url);

    try
    {
        g_qr = new qrcodegen::QrCode(qrcodegen::QrCode::encodeText(url, qrcodegen::QrCode::Ecc::MEDIUM));
    }
    catch (...)
    {
        g_qr = NULL;
        WriteLog("qr code generation failed");
    }
    WriteLog("control page: %s", url);

    WNDCLASSEXW cls;
    memset(&cls, 0, sizeof(cls));
    cls.cbSize = sizeof(cls);
    cls.style = CS_HREDRAW | CS_VREDRAW;
    cls.lpfnWndProc = WindowProc;
    cls.hInstance = g_module;
    cls.hCursor = LoadCursorW(NULL, IDC_ARROW);
    cls.hbrBackground = (HBRUSH)GetStockObject(WHITE_BRUSH);
    cls.lpszClassName = L"SmtWebControlWindow";
    if (RegisterClassExW(&cls) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
    {
        WriteLog("RegisterClass failed: %lu", GetLastError());
        return 0;
    }

    DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    RECT rect = { 0, 0, kClientWidth, kClientHeight };
    AdjustWindowRectEx(&rect, style, FALSE, 0);
    int windowWidth = rect.right - rect.left;
    int windowHeight = rect.bottom - rect.top;

    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    int x = work.left + ((work.right - work.left) - windowWidth) / 2;
    int y = work.top + ((work.bottom - work.top) - windowHeight) / 2;

    g_window = CreateWindowExW(0, L"SmtWebControlWindow", L"手机控制 - SMT",
        style, x, y, windowWidth, windowHeight, NULL, NULL, g_module, NULL);
    if (g_window == NULL)
    {
        WriteLog("CreateWindow failed: %lu", GetLastError());
        return 0;
    }
    WriteLog("control window created");

    ShowWindow(g_window, SW_SHOW);
    UpdateWindow(g_window);
    SetForegroundWindow(g_window);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0)
    {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    g_window = NULL;
    if (g_qr != NULL)
    {
        delete g_qr;
        g_qr = NULL;
    }
    return 0;
}

/** 停止时等待服务/窗口线程退出，然后释放本模块的一次引用，让宿主能真正卸载 DLL */
DWORD WINAPI ShutdownThread(LPVOID)
{
    if (g_thread != NULL)
    {
        WaitForSingleObject(g_thread, 1500);
        CloseHandle(g_thread);
        g_thread = NULL;
    }
    if (g_uiThread != NULL)
    {
        WaitForSingleObject(g_uiThread, 1000);
        CloseHandle(g_uiThread);
        g_uiThread = NULL;
    }
    FreeLibraryAndExitThread(g_module, 0);
    return 0;
}

DWORD WINAPI ServerThread(LPVOID)
{
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0)
    {
        WriteLog("WSAStartup failed: %d", WSAGetLastError());
        return 0;
    }

    int port = g_port;
    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET)
    {
        WriteLog("socket failed: %d", WSAGetLastError());
        WSACleanup();
        return 0;
    }

    const char reuse = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons((u_short)port);

    if (bind(listener, (sockaddr*)&address, sizeof(address)) != 0)
    {
        WriteLog("bind %d failed: %d", port, WSAGetLastError());
        closesocket(listener);
        WSACleanup();
        return 0;
    }
    if (listen(listener, SOMAXCONN) != 0)
    {
        WriteLog("listen %d failed: %d", port, WSAGetLastError());
        closesocket(listener);
        WSACleanup();
        return 0;
    }

    g_listenSocket = listener;
    WriteLog("static server started on port %d", port);

    while (InterlockedCompareExchange(&g_stop, 0, 0) == 0)
    {
        SOCKET client = accept(listener, NULL, NULL);
        if (client == INVALID_SOCKET) break;
        g_clientSocket = client;
        HandleClient(client);
        g_clientSocket = INVALID_SOCKET;
        closesocket(client);
    }

    if (g_listenSocket != INVALID_SOCKET)
    {
        closesocket(g_listenSocket);
        g_listenSocket = INVALID_SOCKET;
    }
    WSACleanup();
    WriteLog("static server stopped");
    return 0;
}

void StopServer(bool wait)
{
    InterlockedExchange(&g_stop, 1);
    if (g_listenSocket != INVALID_SOCKET)
    {
        closesocket(g_listenSocket);
        g_listenSocket = INVALID_SOCKET;
    }
    // 中断正在处理的请求，避免关闭时卡在 recv/send
    if (g_clientSocket != INVALID_SOCKET)
    {
        closesocket(g_clientSocket);
        g_clientSocket = INVALID_SOCKET;
    }
    if (g_window != NULL)
    {
        PostMessageW(g_window, kCloseWindowMessage, 0, 0);
    }
    if (wait && g_thread != NULL)
    {
        WaitForSingleObject(g_thread, 1500);
        CloseHandle(g_thread);
        g_thread = NULL;
    }
    if (wait && g_uiThread != NULL)
    {
        WaitForSingleObject(g_uiThread, 800);
        CloseHandle(g_uiThread);
        g_uiThread = NULL;
    }
}

} // namespace

extern "C" __declspec(dllexport) void onExit()
{
    // 和 webcontroler.dll 一样：只发起关闭，立即返回。
    // 由后台线程等待服务/窗口退出后释放一次模块引用，宿主再 FreeLibrary 才会真正卸载。
    WriteLog("onExit called");
    StopServer(false);
    if (InterlockedCompareExchange(&g_shutdownStarted, 1, 0) == 0)
    {
        CreateThread(NULL, 0, ShutdownThread, NULL, 0, NULL);
    }
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        g_module = module;
        DisableThreadLibraryCalls(module);

        InterlockedExchange(&g_stop, 0);
        g_port = ReadPort();
        WriteLog("DllMain attach, pid=%lu", GetCurrentProcessId());
        g_thread = CreateThread(NULL, 0, ServerThread, NULL, 0, NULL);
        g_uiThread = CreateThread(NULL, 0, UiThread, NULL, 0, NULL);
    }
    else if (reason == DLL_PROCESS_DETACH)
    {
        WriteLog("DllMain detach");
        // 卸载前必须等线程退出，否则模块被释放后线程还在执行会导致崩溃
        StopServer(true);
    }
    return TRUE;
}
