package v1

import (
	"context"
	"sort"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/graph"
)

// GET /home
func (s *Server) GetHome(ctx context.Context, request GetHomeRequestObject) (GetHomeResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetHome401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	// Get database info
	dbInfo, err := s.db.Queries.GetDatabaseInfo(ctx, auth.UserName)
	if err != nil {
		log.Error("GetDatabaseInfo DB Error:", err)
		return GetHome500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	// Get streaks
	streaks, err := s.db.Queries.GetUserStreaks(ctx, auth.UserName)
	if err != nil {
		log.Error("GetUserStreaks DB Error:", err)
		return GetHome500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	// Get graph data
	graphData, err := s.db.Queries.GetDailyReadStats(ctx, auth.UserName)
	if err != nil {
		log.Error("GetDailyReadStats DB Error:", err)
		return GetHome500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	// Get user statistics
	userStats, err := s.db.Queries.GetUserStatistics(ctx)
	if err != nil {
		log.Error("GetUserStatistics DB Error:", err)
		return GetHome500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	// Build response
	response := HomeResponse{
		DatabaseInfo: DatabaseInfo{
			DocumentsSize: dbInfo.DocumentsSize,
			ActivitySize:  dbInfo.ActivitySize,
			ProgressSize:  dbInfo.ProgressSize,
			DevicesSize:   dbInfo.DevicesSize,
		},
		Streaks: StreaksResponse{
			Streaks: convertStreaks(streaks),
			User: UserData{
				Username: auth.UserName,
				IsAdmin:  auth.IsAdmin,
			},
		},
		GraphData: GraphDataResponse{
			GraphData: convertGraphData(graphData),
			User: UserData{
				Username: auth.UserName,
				IsAdmin:  auth.IsAdmin,
			},
		},
		UserStatistics: arrangeUserStatistics(userStats),
		User: UserData{
			Username: auth.UserName,
			IsAdmin:  auth.IsAdmin,
		},
	}

	return GetHome200JSONResponse(response), nil
}

// GET /home/streaks
func (s *Server) GetStreaks(ctx context.Context, request GetStreaksRequestObject) (GetStreaksResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetStreaks401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	streaks, err := s.db.Queries.GetUserStreaks(ctx, auth.UserName)
	if err != nil {
		log.Error("GetUserStreaks DB Error:", err)
		return GetStreaks500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	response := StreaksResponse{
		Streaks: convertStreaks(streaks),
		User: UserData{
			Username: auth.UserName,
			IsAdmin:  auth.IsAdmin,
		},
	}

	return GetStreaks200JSONResponse(response), nil
}

// GET /home/graph
func (s *Server) GetGraphData(ctx context.Context, request GetGraphDataRequestObject) (GetGraphDataResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetGraphData401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	graphData, err := s.db.Queries.GetDailyReadStats(ctx, auth.UserName)
	if err != nil {
		log.Error("GetDailyReadStats DB Error:", err)
		return GetGraphData500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	response := GraphDataResponse{
		GraphData: convertGraphData(graphData),
		User: UserData{
			Username: auth.UserName,
			IsAdmin:  auth.IsAdmin,
		},
	}

	return GetGraphData200JSONResponse(response), nil
}

// GET /home/statistics
func (s *Server) GetUserStatistics(ctx context.Context, request GetUserStatisticsRequestObject) (GetUserStatisticsResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetUserStatistics401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	userStats, err := s.db.Queries.GetUserStatistics(ctx)
	if err != nil {
		log.Error("GetUserStatistics DB Error:", err)
		return GetUserStatistics500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	response := arrangeUserStatistics(userStats)
	response.User = UserData{
		Username: auth.UserName,
		IsAdmin:  auth.IsAdmin,
	}

	return GetUserStatistics200JSONResponse(response), nil
}

func convertStreaks(streaks []database.UserStreak) []UserStreak {
	result := make([]UserStreak, len(streaks))
	for i, streak := range streaks {
		result[i] = UserStreak{
			Window:               streak.Window,
			MaxStreak:            streak.MaxStreak,
			MaxStreakStartDate:   streak.MaxStreakStartDate,
			MaxStreakEndDate:     streak.MaxStreakEndDate,
			CurrentStreak:        streak.CurrentStreak,
			CurrentStreakStartDate: streak.CurrentStreakStartDate,
			CurrentStreakEndDate:   streak.CurrentStreakEndDate,
		}
	}
	return result
}

func convertGraphData(graphData []database.GetDailyReadStatsRow) []GraphDataPoint {
	result := make([]GraphDataPoint, len(graphData))
	for i, data := range graphData {
		result[i] = GraphDataPoint{
			Date:        data.Date,
			MinutesRead: data.MinutesRead,
		}
	}
	return result
}

func arrangeUserStatistics(userStatistics []database.GetUserStatisticsRow) UserStatisticsResponse {
	// Sort helper - sort by WPM
	sortByWPM := func(stats []database.GetUserStatisticsRow) []LeaderboardEntry {
		sorted := append([]database.GetUserStatisticsRow(nil), stats...)
		sort.SliceStable(sorted, func(i, j int) bool {
			return sorted[i].TotalWpm > sorted[j].TotalWpm
		})

		result := make([]LeaderboardEntry, len(sorted))
		for i, item := range sorted {
			result[i] = LeaderboardEntry{UserId: item.UserID, Value: int64(item.TotalWpm)}
		}
		return result
	}

	// Sort by duration (seconds)
sortByDuration := func(stats []database.GetUserStatisticsRow) []LeaderboardEntry {
		sorted := append([]database.GetUserStatisticsRow(nil), stats...)
		sort.SliceStable(sorted, func(i, j int) bool {
			return sorted[i].TotalSeconds > sorted[j].TotalSeconds
		})

		result := make([]LeaderboardEntry, len(sorted))
		for i, item := range sorted {
			result[i] = LeaderboardEntry{UserId: item.UserID, Value: item.TotalSeconds}
		}
		return result
	}

	// Sort by words
sortByWords := func(stats []database.GetUserStatisticsRow) []LeaderboardEntry {
		sorted := append([]database.GetUserStatisticsRow(nil), stats...)
		sort.SliceStable(sorted, func(i, j int) bool {
			return sorted[i].TotalWordsRead > sorted[j].TotalWordsRead
		})

		result := make([]LeaderboardEntry, len(sorted))
		for i, item := range sorted {
			result[i] = LeaderboardEntry{UserId: item.UserID, Value: item.TotalWordsRead}
		}
		return result
	}

	return UserStatisticsResponse{
		Wpm: LeaderboardData{
			All:   sortByWPM(userStatistics),
			Year:  sortByWPM(userStatistics),
			Month: sortByWPM(userStatistics),
			Week:  sortByWPM(userStatistics),
		},
		Duration: LeaderboardData{
			All:   sortByDuration(userStatistics),
			Year:  sortByDuration(userStatistics),
			Month: sortByDuration(userStatistics),
			Week:  sortByDuration(userStatistics),
		},
		Words: LeaderboardData{
			All:   sortByWords(userStatistics),
			Year:  sortByWords(userStatistics),
			Month: sortByWords(userStatistics),
			Week:  sortByWords(userStatistics),
		},
	}
}

// GetSVGGraphData generates SVG bezier path for graph visualization
func GetSVGGraphData(inputData []GraphDataPoint, svgWidth int, svgHeight int) graph.SVGGraphData {
	// Convert to int64 slice expected by graph package
	intData := make([]int64, len(inputData))
	
	for i, data := range inputData {
		intData[i] = int64(data.MinutesRead)
	}
	
	return graph.GetSVGGraphData(intData, svgWidth, svgHeight)
}