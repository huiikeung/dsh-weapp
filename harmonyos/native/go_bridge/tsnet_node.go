package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/net/netns"
	"tailscale.com/tsnet"
)

// 轻量 tsnet 节点：只做“加入 tailnet + 本机 TCP 转发”，不启动 tailscaled 的完整控制循环，
// 冷启动比 tsd 引擎快得多（毫秒~秒级），用于手机端内嵌隧道。

var (
	tsqMu            sync.Mutex
	tsqServer        *tsnet.Server
	tsqProxy         net.Listener
	tsqProxyTarget   string
	tsqLoginStarted  bool
	tsqAuthURL      string
	tsqUpError      string
	tsqStateDir     string
	tsqUpDone       chan struct{}
	tsqLogBuffer    []string
	tsqStartError   string
	tsqCachedStatus string
	tsqAuthMode     string
	tsqProbeResult  string
	tsqAccountCache string
)

// 复用旧 tsd 引擎留下的 tailscaled.state（同版本格式兼容），避免重新登录。
func tsqFindStateDir(root string) string {
	if root == "" {
		return root
	}
	var found string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if entry.IsDir() && strings.Count(strings.TrimPrefix(path, root), string(os.PathSeparator)) > 2 {
			return filepath.SkipDir
		}
		if !entry.IsDir() && entry.Name() == "tailscaled.state" {
			found = filepath.Dir(path)
		}
		return nil
	})
	if found != "" {
		return found
	}
	return root
}

func tsqLogf(format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	tsqMu.Lock()
	tsqLogBuffer = append(tsqLogBuffer, message)
	if len(tsqLogBuffer) > 60 {
		tsqLogBuffer = tsqLogBuffer[len(tsqLogBuffer)-60:]
	}
	tsqMu.Unlock()
	index := strings.Index(message, "https://login.tailscale.com/")
	if index < 0 {
		return
	}
	tail := message[index:]
	if end := strings.IndexAny(tail, " \n\t"); end > 0 {
		tail = tail[:end]
	}
	tsqMu.Lock()
	tsqAuthURL = tail
	tsqMu.Unlock()
}

func tsqStatusDirect() string {
	server := tsqServer
	if server == nil {
		return "FAILED | tsnet | not started"
	}
	client, err := server.LocalClient()
	if err != nil {
		return "OK | engine=tsnet | state=Starting | upError=" + tsqUpError
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := client.Status(ctx)
	if err != nil {
		return "OK | engine=tsnet | state=Starting"
	}
	if status.BackendState == "NeedsLogin" && status.AuthURL == "" && !tsqLoginStarted {
		tsqLoginStarted = true
		loginCtx, loginCancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = client.StartLoginInteractive(loginCtx)
		loginCancel()
		time.Sleep(400 * time.Millisecond)
		if again, againErr := client.Status(ctx); againErr == nil {
			status = again
		}
	}
	dns := ""
	if status.Self != nil {
		dns = status.Self.DNSName
	}
	ips := 0
	if status.Self != nil {
		ips = len(status.Self.TailscaleIPs)
	}
	authURL := status.AuthURL
	if authURL == "" {
		authURL = tsqAuthURL
	}
	return "OK | engine=tsnet | state=" + string(status.BackendState) + " | upError=" + tsqUpError + " | tailscaleIPs=" +
		strconv.Itoa(ips) + " | dnsName=" + dns + " | authURL=" + authURL
}

// 在锁外执行所有可能阻塞的调用，结果以字符串返回。
func tsqPollStatus(server *tsnet.Server) string {
	tsqMu.Lock()
	stateDir := tsqStateDir
	startErr := tsqStartError
	upErr := tsqUpError
	loggedURL := tsqAuthURL
	tsqMu.Unlock()
	client, err := server.LocalClient()
	if err != nil {
		return "OK | engine=tsnet | state=Starting | dir=" + stateDir + " | startErr=" + startErr
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	status, err := client.Status(ctx)
	if err != nil {
		return "OK | engine=tsnet | state=Starting | dir=" + stateDir + " | startErr=" + startErr
	}
	dnsName := ""
	if status.Self != nil {
		dnsName = status.Self.DNSName
	}
	authURL := status.AuthURL
	if authURL == "" {
		authURL = loggedURL
	}
	stateFile := stateDir + "/tsnet-node/tailscaled.state"
	stateSize := int64(-1)
	if fi, statErr := os.Stat(stateFile); statErr == nil {
		stateSize = fi.Size()
	}
	return "OK | engine=tsnet | state=" + string(status.BackendState) + " | authMode=" + tsqAuthMode + " | dir=" + stateDir +
		" | stateBytes=" + strconv.FormatInt(stateSize, 10) + " | startErr=" + startErr +
		" | upError=" + upErr + " | dnsName=" + dnsName + " | authURL=" + authURL + " | tailscaleIPs=" + strconv.Itoa(len(status.TailscaleIPs))
}

// tsqProbeControl 探测控制面：DNS 解析 + 每个地址的 TCP/TLS 握手
func tsqProbeControl(control string, upErr error) string {
	host := control
	if strings.HasPrefix(host, "https://") {
		host = host[len("https://"):]
	} else if strings.HasPrefix(host, "http://") {
		host = host[len("http://"):]
	}
	if i := strings.IndexByte(host, '/'); i >= 0 {
		host = host[:i]
	}
	if host == "" {
		host = "controlplane.tailscale.com"
	}
	result := "upErr=" + upErr.Error() + " host=" + host
	defer func() {
		tsqMu.Lock()
		tsqProbeResult = result
		tsqMu.Unlock()
	}()
	addrs, dnsErr := net.LookupHost(host)
	if dnsErr != nil {
		return result + " | dns=ERR:" + dnsErr.Error()
	}
	result += " | dns=" + strings.Join(addrs, ",")
	for _, addr := range addrs {
		ip := net.ParseIP(addr)
		network := "tcp4"
		if ip != nil && ip.To4() == nil {
			network = "tcp6"
		}
		dialer := net.Dialer{Timeout: 8 * time.Second}
		conn, dialErr := dialer.Dial(network, net.JoinHostPort(addr, "443"))
		if dialErr != nil {
			result += " | " + addr + " dial=" + dialErr.Error()
			continue
		}
		tlsConn := tls.Client(conn, &tls.Config{ServerName: host})
		_ = tlsConn.SetDeadline(time.Now().Add(8 * time.Second))
		if hsErr := tlsConn.Handshake(); hsErr != nil {
			result += " | " + addr + " tls=" + hsErr.Error()
		} else {
			result += " | " + addr + " tls=OK"
		}
		_ = conn.Close()
	}
	return result
}

//export TSQStart
func TSQStart(hostname *C.char, stateDir *C.char, controlURL *C.char, authKey *C.char) *C.char {
	host := C.GoString(hostname)
	baseDir := C.GoString(stateDir)
	// OHOS 上 netmon 拿不到默认路由，netns 绑定接口会让控制面/DERP 拨号全部超时；
	// 退化为普通 net.Dialer（实测可正常 TLS 连接控制面）
	netns.SetEnabled(false)
	tsqMu.Lock()
	tsqStateDir = baseDir
	tsqMu.Unlock()
	dir := baseDir
	if baseDir != "" {
		dir = baseDir + "/tsnet-node"
		_ = os.MkdirAll(dir, 0o700)
	}
	control := C.GoString(controlURL)
	authKeyValue := strings.TrimSpace(C.GoString(authKey))
	authMode := "account"
	if authKeyValue != "" {
		authMode = "authKey"
	}
	tsqMu.Lock()
	tsqAuthMode = authMode
	tsqMu.Unlock()
	if dir == "" {
		return C.CString("FAILED | tsnet | empty state dir")
	}
	tsqMu.Lock()
	if tsqServer != nil {
		status := tsqStatusDirect()
		tsqMu.Unlock()
		return C.CString(status)
	}
	server := &tsnet.Server{
		Hostname:   host,
		Dir:        dir,
		ControlURL: control,
		AuthKey:    authKeyValue,
		Ephemeral:  false,
		Logf:       tsqLogf,
		UserLogf:   tsqLogf,
	}
	tsqServer = server
	tsqCachedStatus = "OK | engine=tsnet | state=Starting"
	done := make(chan struct{})
	tsqUpDone = done
	tsqMu.Unlock()

	go func() {
		defer close(done)
		upCtx, upCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer upCancel()
		_, upErr := server.Up(upCtx)
		if upErr != nil {
			tsqMu.Lock()
			tsqUpError = upErr.Error()
			tsqMu.Unlock()
			// 诊断：Up 失败时探测控制面 DNS/TCP/TLS，结果写入日志缓冲
			tsqLogf("TSQ probe: %s", tsqProbeControl(control, upErr))
		}
	}()
	// 异步轮询状态：所有阻塞调用都在锁外，TSQStatus 只读缓存，绝不阻塞 JS 线程
	go func() {
		for {
			tsqMu.Lock()
			alive := tsqServer == server
			tsqMu.Unlock()
			if !alive {
				return
			}
			cached := tsqPollStatus(server)
			tsqMu.Lock()
			tsqCachedStatus = cached
			needAccount := strings.Contains(cached, "state=Running") && tsqAccountCache == ""
			tsqMu.Unlock()
			if needAccount {
				if acct := tsqAccountSummary(server); acct != "" {
					tsqMu.Lock()
					tsqAccountCache = acct
					tsqMu.Unlock()
				}
			}
			time.Sleep(800 * time.Millisecond)
		}
	}()
	return C.CString("OK | engine=tsnet | state=Starting")
}

// tsqAccountSummary 返回当前登录账号摘要（URL 转义，用 | 分隔）：display|login|tailnet|addresses
func tsqAccountSummary(srv *tsnet.Server) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	lc, err := srv.LocalClient()
	if err != nil {
		return ""
	}
	st, err := lc.Status(ctx)
	if err != nil || st == nil {
		return ""
	}
	display, login := "", ""
	if st.Self != nil {
		if u, ok := st.User[st.Self.UserID]; ok {
			display = u.DisplayName
			login = u.LoginName
		}
	}
	addrs := ""
	if st.Self != nil {
		parts := make([]string, 0, len(st.Self.TailscaleIPs))
		for _, ip := range st.Self.TailscaleIPs {
			parts = append(parts, ip.String())
		}
		addrs = strings.Join(parts, ",")
	}
	tailnetName := ""
	if st.CurrentTailnet != nil {
		tailnetName = st.CurrentTailnet.Name
	}
	return url.QueryEscape(display) + "|" + url.QueryEscape(login) + "|" +
		url.QueryEscape(tailnetName) + "|" + url.QueryEscape(addrs)
}

//export TSQStatus
func TSQStatus() *C.char {
	tsqMu.Lock()
	cached := tsqCachedStatus
	probe := tsqProbeResult
	account := tsqAccountCache
	tsqMu.Unlock()
	if account != "" {
		cached += " | account=" + account
	}
	if cached == "" {
		cached = "OK | engine=tsnet | state=Starting"
	}
	if probe != "" {
		cached = "probe=" + probe + " | " + cached
	}
	return C.CString(cached)
}

//export TSQDebug
func TSQDebug() *C.char {
	tsqMu.Lock()
	lines := make([]string, len(tsqLogBuffer))
	copy(lines, tsqLogBuffer)
	tsqMu.Unlock()
	return C.CString(strings.Join(lines, "\n"))
}

//export TSQAuthURL
func TSQAuthURL() *C.char {
	tsqMu.Lock()
	url := tsqAuthURL
	tsqMu.Unlock()
	return C.CString(url)
}

//export TSQStop
func TSQStop() *C.char {
	tsqMu.Lock()
	server := tsqServer
	proxy := tsqProxy
	tsqServer = nil
	tsqProxy = nil
	tsqUpDone = nil
	tsqCachedStatus = "OK | engine=tsnet | state=NoState"
	tsqProbeResult = ""
	tsqAccountCache = ""
	tsqMu.Unlock()
	// 关闭 tsnet 会等待内部 goroutine 退出（数百毫秒~数秒），放到后台执行，避免阻塞 UI 线程
	go func() {
		if proxy != nil {
			_ = proxy.Close()
		}
		if server != nil {
			_ = server.Close()
		}
	}()
	return C.CString("OK | tsnet stopping")
}

func tsqProxyConn(local net.Conn, target string, useTLS bool) {
	defer local.Close()
	tsqMu.Lock()
	server := tsqServer
	tsqMu.Unlock()
	if server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	remote, err := server.Dial(ctx, "tcp", target)
	cancel()
	if err != nil {
		return
	}
	defer remote.Close()
	var conn net.Conn = remote
	if useTLS {
		host, _, _ := net.SplitHostPort(target)
		tlsConn := tls.Client(remote, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if err := tlsConn.Handshake(); err != nil {
			return
		}
		conn = tlsConn
	}
	done := make(chan struct{}, 1)
	go func() {
		_, _ = io.Copy(conn, local)
		done <- struct{}{}
	}()
	_, _ = io.Copy(local, conn)
	<-done
}

//export TSQWarm
func TSQWarm(targetHost *C.char, targetPort C.int) *C.char {
	host := C.GoString(targetHost)
	port := int(targetPort)
	tsqMu.Lock()
	server := tsqServer
	tsqMu.Unlock()
	if server == nil {
		return C.CString("FAILED | tsnet warm | not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := server.Dial(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return C.CString("FAILED | tsnet warm | " + err.Error())
	}
	_ = conn.Close()
	return C.CString("OK | tsnet warm " + host)
}

//export TSQProxyStart
func TSQProxyStart(targetHost *C.char, targetPort C.int, listenPort C.int, useTLS C.int) *C.char {
	host := C.GoString(targetHost)
	port := int(targetPort)
	listen := int(listenPort)
	if host == "" || port <= 0 || port > 65535 || listen <= 0 || listen > 65535 {
		return C.CString("FAILED | tsnet proxy | invalid args")
	}
	target := net.JoinHostPort(host, strconv.Itoa(port))
	tsqMu.Lock()
	if tsqProxy != nil && tsqProxyTarget == target {
		tsqMu.Unlock()
		return C.CString("OK | tsnet proxy already 127.0.0.1:" + strconv.Itoa(listen) + " -> " + target)
	}
	old := tsqProxy
	tsqProxy = nil
	tsqProxyTarget = target
	tsqMu.Unlock()
	if old != nil {
		_ = old.Close()
		time.Sleep(30 * time.Millisecond)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(listen))
	if err != nil {
		return C.CString("FAILED | tsnet proxy listen | " + err.Error())
	}
	tsqMu.Lock()
	tsqProxy = listener
	tsqMu.Unlock()
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go tsqProxyConn(conn, target, useTLS != 0)
		}
	}()
	return C.CString("OK | tsnet proxy 127.0.0.1:" + strconv.Itoa(listen) + " tls=" + strconv.FormatBool(useTLS != 0) + " -> " + target)
}

// 编译期引用，避免 ipn 未使用（保持与主引擎一致的依赖集合）
var _ = ipn.NeedsLogin
