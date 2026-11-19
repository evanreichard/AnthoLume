package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	openapiTypes "github.com/oapi-codegen/runtime/types"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

const insightPageSize = 20

func (s *webAPI) insightsZone(ctx context.Context) (*time.Location, error) {
	user, err := s.api.db.Queries.GetUser(requestContext(ctx), webUser(ctx).UserName)
	if err != nil {
		return nil, err
	}
	if user.Timezone == nil {
		return time.UTC, nil
	}
	zone, err := time.LoadLocation(*user.Timezone)
	if err != nil {
		return time.UTC, nil
	} // Legacy settings accepted invalid zone names.
	return zone, nil
}

func civilDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
func monday(t time.Time) time.Time { return t.AddDate(0, 0, -(int(t.Weekday())+6)%7) }

type streak struct {
	last                  time.Time
	run, current, longest int
	connected             bool
}

func (s *streak) add(date, today time.Time, step int) {
	if date.Equal(s.last) {
		return
	}
	if s.last.IsZero() {
		s.connected = !date.Before(today.AddDate(0, 0, -step))
		s.run = 1
	} else if date.Equal(s.last.AddDate(0, 0, -step)) {
		s.run++
	} else {
		s.run = 1
		s.connected = false
	}
	s.last = date
	if s.connected {
		s.current = s.run
	}
	s.longest = max(s.longest, s.run)
}

func (s *webAPI) GetInsights(ctx context.Context, _ GetInsightsRequestObject) (GetInsightsResponseObject, error) {
	zone, err := s.insightsZone(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	today := civilDay(now.In(zone))
	out := Insights{Timezone: zone.String(), AsOf: now, Days: make([]InsightDay, 30)}
	for i := range out.Days {
		out.Days[i].Date = openapiTypes.Date{Time: today.AddDate(0, 0, i-29)}
	}
	days, err := s.api.db.Queries.ListWebInsightDays(requestContext(ctx), database.ListWebInsightDaysParams{
		Timezone: zone.String(), UserID: webUser(ctx).UserName, AsOf: now.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, err
	}
	var daily, weekly streak
	for _, day := range days {
		date, err := time.Parse(time.DateOnly, day.Day)
		if err != nil {
			return nil, err
		}
		daily.add(date, today, 1)
		weekly.add(monday(date), monday(today), 7)
		index := 29 - int(today.Sub(date).Hours()/24)
		if index >= 0 && index < len(out.Days) {
			out.ActiveDays++
			out.SecondsRead += day.Seconds
			out.Days[index].SecondsRead = day.Seconds
		}
	}
	out.CurrentStreak, out.LongestStreak = daily.current, daily.longest
	out.CurrentWeekStreak, out.LongestWeekStreak = weekly.current, weekly.longest
	return GetInsights200JSONResponse(out), nil
}

func insightOffset(page *int) int {
	if page == nil {
		return 0
	}
	return (*page - 1) * insightPageSize
}

type insightCursor struct {
	Time string `json:"t"`
	ID   string `json:"i"`
}

func (c insightCursor) encode() string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data)
}

func parseInsightCursor(raw *string, page *int) (insightCursor, error) {
	var cursor insightCursor
	if raw == nil {
		return cursor, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(*raw)
	if page != nil || err != nil || json.Unmarshal(data, &cursor) != nil || len(cursor.ID) == 0 || len(cursor.ID) > 512 {
		return cursor, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	if _, err := insightInstant(cursor.Time); err != nil {
		return cursor, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	return cursor, nil
}

func insightInstant(raw string) (time.Time, error) {
	value, err := time.Parse(time.RFC3339, raw)
	return value.UTC(), err
}

func (s *webAPI) ListInsightActivity(ctx context.Context, r ListInsightActivityRequestObject) (ListInsightActivityResponseObject, error) {
	zone, err := s.insightsZone(ctx)
	if err != nil {
		return nil, err
	}
	out := InsightActivityPage{Timezone: zone.String(), Items: []InsightActivity{}}
	params := database.ListWebInsightActivityParams{
		UserID: webUser(ctx).UserName, AsOf: time.Now().UTC().Format(time.RFC3339Nano),
		DocumentID: r.Params.Document, PageSize: insightPageSize + 1, PageOffset: int64(insightOffset(r.Params.Page)),
	}
	if r.Params.Day != nil {
		day := r.Params.Day.Time
		start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, zone)
		dayStart := start.UTC().Format("2006-01-02T15:04:05")
		dayEnd := start.AddDate(0, 0, 1).UTC().Format("2006-01-02T15:04:05")
		params.DayStart, params.DayEnd = &dayStart, &dayEnd
	}
	cursor, err := parseInsightCursor(r.Params.Cursor, r.Params.Page)
	if err != nil {
		return nil, err
	}
	params.CursorID, params.CursorTime = cursor.ID, cursor.Time
	rows, err := s.api.db.Queries.ListWebInsightActivity(requestContext(ctx), params)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if len(out.Items) == insightPageSize {
			out.HasMore = true
			next := cursor.encode()
			out.NextCursor = &next
			break
		}
		startedAt, err := insightInstant(row.StartTime)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, InsightActivity{
			Id: row.ID, DocumentId: row.DocumentID, Title: row.Title, Available: row.Available,
			StartedAt: startedAt, Duration: row.Duration, StartFraction: row.StartPercentage, EndFraction: row.EndPercentage,
		})
		cursor = insightCursor{Time: row.StartTime, ID: row.ID}
	}
	return ListInsightActivity200JSONResponse(out), nil
}

func (s *webAPI) ListInsightProgress(ctx context.Context, r ListInsightProgressRequestObject) (ListInsightProgressResponseObject, error) {
	zone, err := s.insightsZone(ctx)
	if err != nil {
		return nil, err
	}
	out := InsightProgressPage{Timezone: zone.String(), Items: []InsightProgress{}}
	cursor, err := parseInsightCursor(r.Params.Cursor, r.Params.Page)
	if err != nil {
		return nil, err
	}
	rows, err := s.api.db.Queries.ListWebInsightProgress(requestContext(ctx), database.ListWebInsightProgressParams{
		UserID: webUser(ctx).UserName, CursorTime: cursor.Time, CursorID: cursor.ID,
		PageSize: insightPageSize + 1, PageOffset: int64(insightOffset(r.Params.Page)),
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if len(out.Items) == insightPageSize {
			out.HasMore = true
			next := cursor.encode()
			out.NextCursor = &next
			break
		}
		updatedAt, err := insightInstant(row.UpdatedAt)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, InsightProgress{
			DocumentId: row.DocumentID, Title: row.Title, Available: row.Available,
			UpdatedAt: updatedAt, Fraction: row.Fraction,
		})
		cursor = insightCursor{Time: row.UpdatedAt, ID: row.DocumentID}
	}
	return ListInsightProgress200JSONResponse(out), nil
}

func (s *webAPI) ListInsightRankings(ctx context.Context, r ListInsightRankingsRequestObject) (ListInsightRankingsResponseObject, error) {
	return s.listInsightRankingsAt(ctx, r.Params, time.Now())
}

func (s *webAPI) listInsightRankingsAt(ctx context.Context, params ListInsightRankingsParams, now time.Time) (ListInsightRankingsResponseObject, error) {
	now = now.UTC()
	out := InsightRankings{AsOf: now, Items: []InsightRank{}}
	metric := "time"
	if params.Metric != nil {
		switch *params.Metric {
		case "time", "words", "pace":
			metric = string(*params.Metric)
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	var start time.Time
	if params.Period != nil {
		switch *params.Period {
		case "week":
			start = now.AddDate(0, 0, -7)
		case "month":
			start = now.AddDate(0, 0, -30)
		case "year":
			start = now.AddDate(0, 0, -365)
		case "all":
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	rows, err := s.api.db.Queries.ListWebInsightRankings(requestContext(ctx), database.ListWebInsightRankingsParams{
		Metric: metric, PeriodStart: start.Format(time.RFC3339Nano), AsOf: now.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out.Items = append(out.Items, InsightRank{User: row.UserID, Value: row.Value})
	}
	return ListInsightRankings200JSONResponse(out), nil
}
