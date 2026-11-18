package api

import (
	"context"
	"time"

	openapiTypes "github.com/oapi-codegen/runtime/types"
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
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `SELECT LOCAL_DATE(start_time, ?), SUM(duration) FROM activity WHERE user_id=? AND julianday(start_time)<=julianday(?) AND duration>0 GROUP BY 1 ORDER BY 1 DESC`, zone.String(), webUser(ctx).UserName, now.Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var daily, weekly streak
	for rows.Next() {
		var day string
		var seconds int64
		if err := rows.Scan(&day, &seconds); err != nil {
			return nil, err
		}
		date, err := time.Parse(time.DateOnly, day)
		if err != nil {
			return nil, err
		}
		daily.add(date, today, 1)
		weekly.add(monday(date), monday(today), 7)
		index := 29 - int(today.Sub(date).Hours()/24)
		if index >= 0 && index < len(out.Days) {
			out.ActiveDays++
			out.SecondsRead += seconds
			out.Days[index].SecondsRead = seconds
		}
	}
	out.CurrentStreak, out.LongestStreak = daily.current, daily.longest
	out.CurrentWeekStreak, out.LongestWeekStreak = weekly.current, weekly.longest
	return GetInsights200JSONResponse(out), rows.Err()
}

func insightOffset(page *int) int {
	if page == nil {
		return 0
	}
	return (*page - 1) * insightPageSize
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
	query := `SELECT a.id,a.document_id,COALESCE(NULLIF(d.title,''),'Untitled book'),COALESCE(d.deleted=0,0),a.start_time,a.duration,a.start_percentage,a.end_percentage FROM activity a LEFT JOIN documents d ON d.id=a.document_id WHERE a.user_id=? AND julianday(a.start_time)<=julianday(?) AND a.duration>0`
	args := []any{webUser(ctx).UserName, time.Now().UTC().Format(time.RFC3339Nano)}
	if r.Params.Document != nil {
		query += ` AND a.document_id=?`
		args = append(args, *r.Params.Document)
	}
	if r.Params.Day != nil {
		day := r.Params.Day.Time
		start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, zone)
		query += ` AND a.start_time>=? AND a.start_time<?`
		args = append(args, start.UTC().Format("2006-01-02T15:04:05"), start.AddDate(0, 0, 1).UTC().Format("2006-01-02T15:04:05"))
	}
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), query+` ORDER BY julianday(a.start_time) DESC,a.id DESC LIMIT ? OFFSET ?`, append(args, insightPageSize+1, insightOffset(r.Params.Page))...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		if len(out.Items) == insightPageSize {
			out.HasMore = true
			break
		}
		var v InsightActivity
		var raw string
		if err := rows.Scan(&v.Id, &v.DocumentId, &v.Title, &v.Available, &raw, &v.Duration, &v.StartFraction, &v.EndFraction); err != nil {
			return nil, err
		}
		v.StartedAt, err = insightInstant(raw)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, v)
	}
	return ListInsightActivity200JSONResponse(out), rows.Err()
}

func (s *webAPI) ListInsightProgress(ctx context.Context, r ListInsightProgressRequestObject) (ListInsightProgressResponseObject, error) {
	zone, err := s.insightsZone(ctx)
	if err != nil {
		return nil, err
	}
	out := InsightProgressPage{Timezone: zone.String(), Items: []InsightProgress{}}
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `SELECT h.document_id,COALESCE(NULLIF(d.title,''),'Untitled book'),COALESCE(d.deleted=0,0),h.updated_at,h.fraction FROM reading_heads h LEFT JOIN documents d ON d.id=h.document_id WHERE h.user_id=? AND h.position IS NOT NULL AND h.updated_at IS NOT NULL ORDER BY h.updated_at DESC,h.document_id ASC LIMIT ? OFFSET ?`, webUser(ctx).UserName, insightPageSize+1, insightOffset(r.Params.Page))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		if len(out.Items) == insightPageSize {
			out.HasMore = true
			break
		}
		var v InsightProgress
		var raw string
		if err := rows.Scan(&v.DocumentId, &v.Title, &v.Available, &raw, &v.Fraction); err != nil {
			return nil, err
		}
		v.UpdatedAt, err = insightInstant(raw)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, v)
	}
	return ListInsightProgress200JSONResponse(out), rows.Err()
}

func (s *webAPI) ListInsightRankings(ctx context.Context, r ListInsightRankingsRequestObject) (ListInsightRankingsResponseObject, error) {
	return s.listInsightRankingsAt(ctx, r.Params, time.Now())
}

func (s *webAPI) listInsightRankingsAt(ctx context.Context, params ListInsightRankingsParams, now time.Time) (ListInsightRankingsResponseObject, error) {
	now = now.UTC()
	out := InsightRankings{AsOf: now, Items: []InsightRank{}}
	expression := "seconds"
	if params.Metric != nil {
		switch *params.Metric {
		case "time":
		case "words":
			expression = "words"
		case "pace":
			expression = "words*60.0/seconds"
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	var start time.Time
	if params.Period != nil {
		switch *params.Period {
		case "week":
			start = monday(civilDay(now))
		case "month":
			start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		case "year":
			start = time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		case "all":
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	lower := start.Format(time.DateOnly)
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `WITH totals AS (SELECT a.user_id, SUM(a.duration) AS seconds, SUM(MAX(0,COALESCE(d.words,0)*(a.end_percentage-a.start_percentage))) AS words FROM activity a JOIN users u ON u.id=a.user_id LEFT JOIN documents d ON d.id=a.document_id WHERE a.start_time>=? AND julianday(a.start_time)<=julianday(?) AND a.duration>0 GROUP BY a.user_id) SELECT user_id,CAST(`+expression+` AS INTEGER) AS value FROM totals WHERE `+expression+`>=1 ORDER BY value DESC,user_id ASC LIMIT 20`, lower, now.Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item InsightRank
		if err := rows.Scan(&item.User, &item.Value); err != nil {
			return nil, err
		}
		out.Items = append(out.Items, item)
	}
	return ListInsightRankings200JSONResponse(out), rows.Err()
}
