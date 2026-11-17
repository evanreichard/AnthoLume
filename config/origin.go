package config

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

func (c *Config) ValidatePublicOrigin() error {
	u, err := url.Parse(c.PublicOrigin)
	if err != nil || u == nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.Contains(u.Host, "*") || c.PublicOrigin != u.Scheme+"://"+u.Host {
		return fmt.Errorf("PUBLIC_ORIGIN must be an exact HTTP(S) origin")
	}
	if u.Scheme == "https" {
		return nil
	}
	loopback := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme == "http" && loopback {
		return nil
	}
	return fmt.Errorf("PUBLIC_ORIGIN requires HTTPS except explicit loopback development")
}
