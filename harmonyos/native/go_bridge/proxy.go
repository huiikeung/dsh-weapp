package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"strconv"
	"sync"
	"time"
)

// 应用内 tailnet 代理：在 127.0.0.1 监听，把连接经 tsnet 引擎拨到 tailnet 目标地址。
// 不创建 TUN、不需要 VPN Extension，因此不占用系统 VPN 槽位。

var (
	proxyTarget string
	proxyMu       sync.Mutex
	proxyListener net.Listener
)

func currentTsnetServer() *tsnetServerHandle {
	harmonyBackend.mu.Lock()
	defer harmonyBackend.mu.Unlock()
	if harmonyBackend.server == nil {
		return nil
	}
	return &tsnetServerHandle{server: harmonyBackend.server}
}

type tsnetServerHandle struct {
	server interface {
		Dial(ctx context.Context, network, address string) (net.Conn, error)
	}
}

func proxyConn(local net.Conn, target string, serverName string, useTLS bool) {
	defer local.Close()
	handle := currentTsnetServer()
	if handle == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	remote, err := handle.server.Dial(ctx, "tcp", target)
	cancel()
	if err != nil {
		return
	}
	defer remote.Close()
	if useTLS {
		tlsRemote := tls.Client(remote, &tls.Config{ServerName: serverName, MinVersion: tls.VersionTLS12})
		if handshakeErr := tlsRemote.Handshake(); handshakeErr != nil {
			return
		}
		remote = tlsRemote
	}
	done := make(chan struct{}, 1)
	go func() {
		_, _ = io.Copy(remote, local)
		done <- struct{}{}
	}()
	_, _ = io.Copy(local, remote)
	<-done
}

//export TSLocalProxyStart
func TSLocalProxyStart(targetHost *C.char, targetPort C.int, listenPort C.int, useTLS C.int) *C.char {
	host := C.GoString(targetHost)
	if host == "" {
		return C.CString("FAILED | proxy | empty target host")
	}
	port := int(targetPort)
	if port <= 0 || port > 65535 {
		return C.CString("FAILED | proxy | invalid target port")
	}
	listen := int(listenPort)
	if listen <= 0 || listen > 65535 {
		listen = 18080
	}
	target := net.JoinHostPort(host, strconv.Itoa(port))
	proxyMu.Lock()
	if proxyListener != nil && proxyTarget == target {
		proxyMu.Unlock()
		return C.CString("OK | proxy already 127.0.0.1:" + strconv.Itoa(listen) + " -> " + target)
	}
	proxyMu.Unlock()
	// 先关闭旧监听再绑定同一端口，避免第二次启动时 address already in use
	proxyMu.Lock()
	old := proxyListener
	proxyListener = nil
	proxyMu.Unlock()
	if old != nil {
		_ = old.Close()
		time.Sleep(30 * time.Millisecond)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(listen))
	if err != nil {
		return C.CString("FAILED | proxy listen | " + err.Error())
	}
	proxyMu.Lock()
	proxyListener = listener
	proxyTarget = target
	proxyMu.Unlock()
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go proxyConn(conn, target, host, useTLS != 0)
		}
	}()
	scheme := "tcp"
	if useTLS != 0 {
		scheme = "tls"
	}
	return C.CString("OK | proxy " + scheme + " 127.0.0.1:" + strconv.Itoa(listen) + " -> " + target)
}

//export TSLocalProxyStop
func TSLocalProxyStop() *C.char {
	proxyMu.Lock()
	listener := proxyListener
	proxyListener = nil
	proxyMu.Unlock()
	if listener != nil {
		_ = listener.Close()
	}
	return C.CString("OK | proxy stopped")
}
