package api

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestInsightsReadAcknowledgedData(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec("UPDATE users SET timezone='America/New_York' WHERE id='alice'")
	zone, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	today := civilDay(time.Now().In(zone))
	yesterday := today.AddDate(0, 0, -1)
	urls := []string{"/api/v1/me/insights", "/api/v1/me/insights/activity", "/api/v1/me/insights/progress", "/api/v1/insights/rankings"}
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other := *f
	other.client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
	for _, path := range urls {
		assertProblem(t, other.call("GET", path, nil, nil), 401, "unauthenticated")
	}
	other.register("bob")
	event := activityPayload()
	event["start_time"] = time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 23, 30, 0, 0, zone).UTC().Format(time.RFC3339)
	// Replay returns the original receipt without adding another journal entry.
	for range 2 {
		r := f.call("POST", "/api/v1/me/activity", event, nil)
		require.Equal(t, 200, r.status, string(r.body))
	}
	p := progressPayload("0", .37)
	p["document_id"] = "book-b"
	r := f.call("POST", "/api/v1/me/reading-progress", p, nil)
	require.Equal(t, 200, r.status, string(r.body))
	r = f.call("GET", urls[0], nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.Contains(t, r.header.Get("Cache-Control"), "no-store")
	result := decodeWeb[Insights](t, r)
	require.Len(t, result.Days, 30)
	require.Equal(t, "America/New_York", result.Timezone)
	require.EqualValues(t, 30, result.SecondsRead)
	require.Equal(t, 1, result.CurrentStreak)
	require.Equal(t, 1, result.CurrentWeekStreak)
	require.Equal(t, yesterday.Format(time.DateOnly), result.Days[28].Date.Format(time.DateOnly))
	require.EqualValues(t, 30, result.Days[28].SecondsRead)
	require.Zero(t, result.Days[29].SecondsRead)
	empty := decodeWeb[Insights](t, other.call("GET", urls[0], nil, nil))
	require.Zero(t, empty.SecondsRead)
	require.Zero(t, empty.CurrentStreak)
	r = f.call("GET", urls[1]+"?day="+yesterday.Format(time.DateOnly)+"&document=book-a", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	activity := decodeWeb[InsightActivityPage](t, r)
	require.Len(t, activity.Items, 1)
	require.Empty(t, decodeWeb[InsightActivityPage](t, other.call("GET", urls[1], nil, nil)).Items)
	require.Empty(t, decodeWeb[InsightActivityPage](t, f.call("GET", urls[1]+"?document=book-b", nil, nil)).Items)
	r = f.call("GET", urls[2], nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	progress := decodeWeb[InsightProgressPage](t, r)
	require.Len(t, progress.Items, 1)
	require.Equal(t, "book-b", progress.Items[0].DocumentId)
	require.Equal(t, .37, *progress.Items[0].Fraction)
	require.Empty(t, decodeWeb[InsightProgressPage](t, other.call("GET", urls[2], nil, nil)).Items)
	r = f.call("GET", urls[3]+"?period=all&metric=time", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, []InsightRank{{User: "alice", Value: 30}}, decodeWeb[InsightRankings](t, r).Items)
	assertProblem(t, f.call("GET", urls[1]+"?page=0", nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", urls[1]+"?cursor=invalid", nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", urls[2]+"?page=1&cursor="+((insightCursor{Time: "2026-06-17T12:00:00Z", ID: "book-b"}).encode()), nil, nil), 400, "invalid_request")
}

func TestInsightRankingsRollingPeriods(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	now := time.Date(2026, time.June, 17, 12, 0, 0, 0, time.UTC)
	for _, instant := range []string{
		"2025-06-17T11:59:59Z", "2025-06-17T12:00:00Z",
		"2026-05-18T11:59:59Z", "2026-05-18T12:00:00Z",
		"2026-06-10T11:59:59Z", "2026-06-10T12:00:00Z",
		"2026-06-17T12:00:00Z", "2026-06-17T12:00:01Z",
	} {
		f.exec("INSERT INTO activity (user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage) VALUES ('alice','book-a','web-device',?,1,0,.1)", instant)
	}
	s := &webAPI{f.api}
	for _, tc := range []struct {
		period ListInsightRankingsParamsPeriod
		want   int64
	}{
		{"week", 2}, {"month", 4}, {"year", 6}, {"all", 7},
	} {
		t.Run(string(tc.period), func(t *testing.T) {
			result, err := s.listInsightRankingsAt(context.Background(), ListInsightRankingsParams{Period: &tc.period}, now)
			require.NoError(t, err)
			require.Equal(t, []InsightRank{{User: "alice", Value: tc.want}}, result.(ListInsightRankings200JSONResponse).Items)
		})
	}
	assertProblem(t, f.call("GET", "/api/v1/insights/rankings?period=invalid", nil, nil), 400, "invalid_request")
}

func TestLibraryLastReadSortsBeforePagination(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	payload := progressPayload("0", .25)
	payload["document_id"] = "book-b"
	r := f.call("POST", "/api/v1/me/reading-progress", payload, nil)
	require.Equal(t, 200, r.status, string(r.body))
	path := "/api/v1/documents?sort=read&page_size=1"
	first := decodeWeb[DocumentPage](t, f.call("GET", path, nil, nil))
	require.Len(t, first.Items, 1)
	require.Equal(t, "book-b", first.Items[0].Id)
	require.NotNil(t, first.Items[0].LastReadAt)
	second := decodeWeb[DocumentPage](t, f.call("GET", path+"&page=2", nil, nil))
	require.Len(t, second.Items, 1)
	require.Equal(t, "book-a", second.Items[0].Id)
	require.Nil(t, second.Items[0].LastReadAt)
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other := *f
	other.client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
	other.register("bob")
	private := decodeWeb[DocumentPage](t, other.call("GET", path, nil, nil))
	require.Len(t, private.Items, 1)
	require.Equal(t, "book-a", private.Items[0].Id)
	require.Nil(t, private.Items[0].LastReadAt)
}

func TestInsightActivityPagesPastLegacyFinalPage(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i <= insightPageSize; i++ {
		start, end := 0.2, 0.3
		if i == insightPageSize {
			start, end = 1, 1.1
		}
		f.exec(`INSERT INTO activity (user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage)
			VALUES ('alice','book-a','web-device',?,30,?,?)`, base.Add(time.Duration(i)*time.Minute).Format(time.RFC3339), start, end)
	}
	const path = "/api/v1/me/insights/activity"
	r := f.call("GET", path, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	page := decodeWeb[InsightActivityPage](t, r)
	require.Len(t, page.Items, insightPageSize)
	require.NotNil(t, page.NextCursor)
	require.Equal(t, 1.0, page.Items[0].StartFraction)
	require.Equal(t, 1.0, page.Items[0].EndFraction)
	require.EqualValues(t, 30, page.Items[0].Duration)
	r = f.call("GET", path+"?cursor="+*page.NextCursor, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	older := decodeWeb[InsightActivityPage](t, r)
	require.Len(t, older.Items, 1)
	require.False(t, older.HasMore)
	require.True(t, base.Equal(older.Items[0].StartedAt))
	require.Equal(t, 0.3, older.Items[0].EndFraction)
	var rawEnd float64
	require.NoError(t, f.db.DB.QueryRow(`SELECT end_percentage FROM activity ORDER BY start_time DESC LIMIT 1`).Scan(&rawEnd))
	require.Equal(t, 1.1, rawEnd)
}

func TestInsightDayFilterAcrossDST(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec("UPDATE users SET timezone='America/New_York' WHERE id='alice'")
	for _, start := range []string{"2024-03-10T04:59:59Z", "2024-03-10T05:00:00.123Z", "2024-03-11T03:59:59Z", "2024-03-11T04:00:00.123Z"} {
		event := activityPayload()
		event["event_id"] = uuid.NewString()
		event["start_time"] = start
		r := f.call("POST", "/api/v1/me/activity", event, nil)
		require.Equal(t, 200, r.status, string(r.body))
	}
	r := f.call("GET", "/api/v1/me/insights/activity?day=2024-03-10", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	items := decodeWeb[InsightActivityPage](t, r).Items
	require.Len(t, items, 2)
	require.Equal(t, "2024-03-11T03:59:59Z", items[0].StartedAt.Format(time.RFC3339Nano))
	require.Equal(t, "2024-03-10T05:00:00.123Z", items[1].StartedAt.Format(time.RFC3339Nano))
}
