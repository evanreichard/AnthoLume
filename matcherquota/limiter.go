package matcherquota

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var ErrLimited = errors.New("catalog rate limited")

const maxQuotaWait = 12 * time.Second

type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

type Window struct {
	Duration time.Duration
	Units    int
}

type window struct {
	Window
	spent []time.Time
}

type providerBudget struct {
	remaining int
	reset     time.Time
}

type Limiter struct {
	gate     chan struct{}
	spacing  time.Duration
	next     time.Time
	cooldown time.Time
	windows  []window
	budgets  map[string]providerBudget
}

func New(spacing time.Duration, limits ...Window) *Limiter {
	l := &Limiter{gate: make(chan struct{}, 1), spacing: spacing, budgets: make(map[string]providerBudget)}
	for _, limit := range limits {
		l.windows = append(l.windows, window{Window: limit})
	}
	return l
}

func (l *Limiter) Client(client Doer, units int) Doer {
	if l == nil {
		return client
	}
	return meteredClient{client, l, units}
}

type meteredClient struct {
	client Doer
	limit  *Limiter
	units  int
}

func (c meteredClient) Do(req *http.Request) (*http.Response, error) {
	ctx, l := req.Context(), c.limit
	if c.units < 1 || c.units > 10 {
		return nil, ErrLimited
	}
	for {
		select {
		case l.gate <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if err := ctx.Err(); err != nil {
			<-l.gate
			return nil, err
		}
		now := time.Now()
		at := l.admission(now, c.units)
		if !at.After(now) {
			defer func() { <-l.gate }()
			l.next = now.Add(time.Duration(c.units) * l.spacing)
			for i := range l.windows {
				for range c.units {
					l.windows[i].spent = append(l.windows[i].spent, now)
				}
			}
			for key, budget := range l.budgets {
				budget.remaining -= c.units
				l.budgets[key] = budget
			}
			resp, err := c.client.Do(req)
			if resp != nil {
				l.observe(time.Now(), resp.StatusCode, resp.Header)
			}
			return resp, err
		}
		<-l.gate
		delay := at.Sub(now)
		if delay > maxQuotaWait {
			return nil, ErrLimited
		}
		timer := time.NewTimer(delay)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		}
	}
}

func (l *Limiter) admission(now time.Time, units int) time.Time {
	at := later(l.next, l.cooldown)
	for key, budget := range l.budgets {
		if !budget.reset.After(now) {
			delete(l.budgets, key)
		} else if units > budget.remaining {
			at = later(at, budget.reset)
		}
	}
	for i := range l.windows {
		w := &l.windows[i]
		for len(w.spent) != 0 && !w.spent[0].Add(w.Duration).After(now) {
			w.spent = w.spent[1:]
		}
		if units > w.Units {
			return now.Add(w.Duration + maxQuotaWait)
		}
		if excess := len(w.spent) + units - w.Units; excess > 0 {
			at = later(at, w.spent[excess-1].Add(w.Duration))
		}
	}
	return at
}

func later(left, right time.Time) time.Time {
	if left.Before(right) {
		return right
	}
	return left
}

func (l *Limiter) observe(now time.Time, status int, h http.Header) {
	retry := retryAfter(now, h.Get("Retry-After"))
	until := retry
	if status == http.StatusTooManyRequests && !until.After(now) {
		until = now.Add(time.Minute)
	}
	for _, prefix := range []string{"RateLimit-", "X-RateLimit-"} {
		for _, scope := range []struct {
			suffix string
			wait   time.Duration
		}{{"", time.Minute}, {"-Minute", time.Minute}, {"-Day", 24 * time.Hour}, {"-Daily", 24 * time.Hour}, {"-Burst", time.Second}} {
			key := prefix + "Remaining" + scope.suffix
			remaining, err := strconv.Atoi(strings.TrimSpace(h.Get(key)))
			if err != nil || remaining < 0 {
				continue
			}
			value := strings.TrimSpace(h.Get(prefix + "Reset" + scope.suffix))
			reset := retryAfter(now, value)
			// Legacy Reset - X-RateLimit-Reset commonly reports a Unix timestamp rather than seconds from now.
			if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds >= 1_000_000_000 {
				reset = time.Unix(seconds, 0)
			}
			if !reset.After(now) {
				if retry.After(now) {
					reset = retry
				} else if remaining == 0 {
					reset = now.Add(scope.wait)
				}
			}
			if reset.After(now) {
				l.budgets[key] = providerBudget{remaining, reset}
				if remaining == 0 && !retry.After(now) && status == http.StatusTooManyRequests {
					until = time.Time{}
				}
			}
		}
	}
	l.cooldown = later(l.cooldown, until)
}

func retryAfter(now time.Time, value string) time.Time {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds >= 0 && seconds <= int64((1<<63-1)/time.Second) {
		return now.Add(time.Duration(seconds) * time.Second)
	}
	if date, err := http.ParseTime(value); err == nil {
		return date
	}
	return time.Time{}
}
