package config

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

func (c *Config) NormalizePublicOrigin() error {
	u, err := url.Parse(c.PublicOrigin)
	if err != nil || u == nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.Contains(u.Host, "*") || c.PublicOrigin != u.Scheme+"://"+u.Host {
		return fmt.Errorf("PUBLIC_ORIGIN must be an exact HTTP(S) origin")
	}
	loopback := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return fmt.Errorf("PUBLIC_ORIGIN requires HTTPS except explicit loopback development")
	}
	// Browser Origin - Browsers omit default ports when serializing an origin.
	if port := u.Port(); (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		c.PublicOrigin = u.Scheme + "://" + strings.TrimSuffix(u.Host, ":"+port)
	}
	return nil
}
