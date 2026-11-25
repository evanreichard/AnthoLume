package matcherquota

import (
	"context"
	"net/http"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
)

type fakeClient func(*http.Request) (*http.Response, error)

func (f fakeClient) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestWeightedRequestsRespectLocalAndProviderBudgets(t *testing.T) {
	for _, tc := range []struct {
		name    string
		weights []int
		windows []Window
		first   http.Header
		times   []time.Duration
	}{
		{"local pacing and window", []int{3, 1, 2}, []Window{{Duration: 5 * time.Second, Units: 4}},
			nil, []time.Duration{0, 3 * time.Second, 5 * time.Second}},
		{"reported remaining units", []int{1, 2}, nil,
			http.Header{"Ratelimit-Remaining": {"1"}, "Ratelimit-Reset": {"5"}}, []time.Duration{0, 5 * time.Second}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				limiter := New(time.Second, tc.windows...)
				start := time.Now()
				var calls []time.Duration
				upstream := fakeClient(func(*http.Request) (*http.Response, error) {
					response := &http.Response{StatusCode: http.StatusOK}
					if len(calls) == 0 {
						response.Header = tc.first
					}
					calls = append(calls, time.Since(start))
					return response, nil
				})
				req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, "https://catalog.invalid", nil)
				require.NoError(t, err)
				for _, units := range tc.weights {
					_, err := limiter.Client(upstream, units).Do(req)
					require.NoError(t, err)
				}
				require.Equal(t, tc.times, calls)
			})
		})
	}
}

func TestCooldownReachesAlreadyWaitingCallsAndHonorsCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		limiter := New(time.Second)
		start := time.Now()
		entered, release := make(chan struct{}), make(chan struct{})
		first := fakeClient(func(*http.Request) (*http.Response, error) {
			close(entered)
			<-release
			return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {"4"}}}, nil
		})
		result := make(chan error, 3)
		go func() {
			req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://catalog.invalid", nil)
			_, err := limiter.Client(first, 1).Do(req)
			result <- err
		}()
		<-entered
		after := fakeClient(func(*http.Request) (*http.Response, error) {
			if d := time.Since(start); d != 4*time.Second {
				t.Errorf("catalog call made at %v; cooldown should last 4s", d)
			}
			return &http.Response{StatusCode: 200}, nil
		})
		go func() {
			req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://catalog.invalid", nil)
			_, err := limiter.Client(after, 1).Do(req)
			result <- err
		}()
		canceled, cancel := context.WithCancel(t.Context())
		req, _ := http.NewRequestWithContext(canceled, http.MethodGet, "https://catalog.invalid", nil)
		go func() {
			_, err := limiter.Client(after, 1).Do(req)
			result <- err
		}()
		synctest.Wait()
		cancel()
		require.ErrorIs(t, <-result, context.Canceled)
		close(release)
		require.NoError(t, <-result)
		require.NoError(t, <-result)
	})
}

func TestQuotaHeadersPauseOtherCallsEvenAfterSuccessfulRequest(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		limiter := New(time.Second)
		now := time.Now()
		h := make(http.Header)
		h.Set("X-RateLimit-Remaining-Day", "0")
		h.Set("X-RateLimit-Reset-Day", now.Add(time.Hour).UTC().Format(http.TimeFormat))
		calls := 0
		client := fakeClient(func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Header: h}, nil
		})
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://catalog.invalid", nil)
		_, err := limiter.Client(client, 1).Do(req)
		require.NoError(t, err)
		_, err = limiter.Client(client, 1).Do(req)
		require.ErrorIs(t, err, ErrLimited)
		require.Equal(t, 1, calls)
		time.Sleep(time.Hour)
		_, err = limiter.Client(client, 1).Do(req)
		require.NoError(t, err)
		require.Equal(t, 2, calls)
	})
}
