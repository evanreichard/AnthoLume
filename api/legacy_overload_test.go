package api

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLegacyCredentialOverloadRetryAfter(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	cases := []struct {
		name, method, path, body string
		headers                  map[string]string
		session                  bool
	}{
		{"ko-auth", "GET", "/api/ko/users/auth", "", koHeaders(), false},
		{"opds-auth", "GET", "/api/opds/", "", map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:password"))}, false},
		{"ko-register", "POST", "/api/ko/users/create", `{"username":"bob","password":"` + md5Password("password") + `"}`, nil, false},
	}
	for _, test := range cases {
		for _, status := range []int{429, 503} {
			name := "rate"
			if status == 503 {
				name = "work"
			}
			t.Run(test.name+"/"+name, func(t *testing.T) {
				f.api.attempts = credentialLimiter{}
				if status == 429 {
					for i := 0; i < 10; i++ {
						require.True(t, f.api.attempts.allow("127.0.0.1"))
					}
				} else {
					for i := 0; i < cap(f.api.identitySlots); i++ {
						f.api.identitySlots <- struct{}{}
					}
					defer func() {
						for i := 0; i < cap(f.api.identitySlots); i++ {
							<-f.api.identitySlots
						}
					}()
				}
				saved := f.client.Jar
				if !test.session {
					f.client.Jar = nil
				}
				defer func() { f.client.Jar = saved }()
				response := f.call(test.method, test.path, test.body, test.headers)
				require.Equal(t, status, response.status, string(response.body))
				require.Equal(t, "60", response.header.Get("Retry-After"))
			})
		}
	}
	require.Equal(t, 1, f.count("users"))
	f.api.attempts = credentialLimiter{}
	unauthenticated := f.call("GET", "/api/opds/", nil, nil)
	require.Equal(t, 401, unauthenticated.status)
	require.Empty(t, unauthenticated.header.Get("Retry-After"))
}
